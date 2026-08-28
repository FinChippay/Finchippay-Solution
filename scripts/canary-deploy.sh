#!/usr/bin/env bash

# scripts/canary-deploy.sh
# Canary deployment orchestrator for Finchippay-Solution.
# Supports frontend (Vercel) and backend (AWS ECS) canary releases.

set -euo pipefail

# Parameters
TARGET="${1:-}"            # frontend | backend
COMMIT_SHA="${2:-$(git rev-parse HEAD 2>/dev/null || echo unknown)}"

# Directory of this script
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CANARY_MONITOR="$SCRIPT_DIR/canary-monitor.js"
ROLLBACK_SCRIPT="$SCRIPT_DIR/rollback.sh"

# Configuration (can be overridden via env vars)
CANARY_WEIGHT_START="${CANARY_WEIGHT_START:-10}"   # initial traffic % for backend
CANARY_WEIGHT_STEP="${CANARY_WEIGHT_STEP:-50}"    # intermediate traffic %
CANARY_WEIGHT_FINAL="${CANARY_WEIGHT_FINAL:-100}" # final traffic %
MONITOR_DURATION_MINUTES="${MONITOR_DURATION_MINUTES:-5}"
HEALTH_CHECK_URL="${HEALTH_CHECK_URL:-http://localhost:4000/health}"

# Pretty output helpers
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color
log_info()  { echo -e "${YELLOW}[canary-deploy]${NC} $*"; }
log_ok()    { echo -e "${GREEN}[canary-deploy] ✓${NC} $*"; }
log_error() { echo -e "${RED}[canary-deploy] ✗${NC} $*"; }

usage() {
  cat <<EOF
Usage: $0 <frontend|backend> [commit-sha]

Deploy a canary release and gradually promote while monitoring health.
EOF
  exit 1
}

if [[ -z "$TARGET" ]]; then
  usage
fi

# ---------------------------------------------------------------------------
# Frontend (Vercel) Canary
# ---------------------------------------------------------------------------

deploy_frontend() {
  log_info "=== Frontend Canary Deployment ==="
  log_info "Commit SHA: $COMMIT_SHA"

  # Validate Vercel environment
  if [[ -z "${VERCEL_TOKEN:-}" ]] || [[ -z "${VERCEL_ORG_ID:-}" ]] || [[ -z "${VERCEL_PROJECT_ID:-}" ]]; then
    log_error "Missing Vercel environment variables (VERCEL_TOKEN, VERCEL_ORG_ID, VERCEL_PROJECT_ID)"
    exit 1
  fi

  # Ensure Vercel CLI is available
  if ! command -v vercel >/dev/null; then
    log_info "Installing Vercel CLI..."
    npm install -g vercel@latest
  fi

  # Deploy preview (canary) version
  PROJECT_DIR="$SCRIPT_DIR/../frontend"
  pushd "$PROJECT_DIR" >/dev/null
  log_info "Deploying preview to Vercel..."
  CANARY_URL=$(vercel deploy --prebuilt --token "$VERCEL_TOKEN" --yes)
  popd >/dev/null
  log_ok "Preview deployed: $CANARY_URL"

  # Assign a stable canary alias (e.g., canary.finchippay.com)
  CANARY_ALIAS="canary-${COMMIT_SHA:0:8}.finchippay.vercel.app"
  log_info "Assigning canary alias: $CANARY_ALIAS"
  vercel alias set "$CANARY_URL" "$CANARY_ALIAS" --token "$VERCEL_TOKEN" || { log_error "Failed to set alias"; exit 1; }
  log_ok "Alias assigned"

  # Health check the canary URL
  CANARY_HEALTH_URL="https://$CANARY_ALIAS/api/health"
  if ! curl -fsS "$CANARY_HEALTH_URL" >/dev/null 2>&1; then
    log_error "Canary health check failed"
    bash "$ROLLBACK_SCRIPT" frontend "$COMMIT_SHA"
    exit 1
  fi
  log_ok "Canary health check passed"

  # Run monitor for the first stage (initial weight)
  log_info "Running monitor (stage: frontend-$CANARY_WEIGHT_START%)"
  if ! node "$CANARY_MONITOR" --duration "$MONITOR_DURATION_MINUTES" --health-url "$CANARY_HEALTH_URL" --stage "frontend-$CANARY_WEIGHT_START%"; then
    log_error "Canary monitoring reported degradation"
    bash "$ROLLBACK_SCRIPT" frontend "$COMMIT_SHA"
    exit 1
  fi

  # Promote to production (blue‑green swap)
  log_info "Promoting canary to production..."
  vercel promote "$CANARY_URL" --token "$VERCEL_TOKEN" || { log_error "Promotion failed"; bash "$ROLLBACK_SCRIPT" frontend "$COMMIT_SHA"; exit 1; }
  log_ok "Promotion succeeded"

  # Cleanup alias (optional – Vercel promotion removes it)
  log_info "Removing canary alias"
  vercel alias rm "$CANARY_ALIAS" --token "$VERCEL_TOKEN" --yes || true
  log_ok "Cleanup complete"
}

# ---------------------------------------------------------------------------
# Backend (AWS ECS) Canary
# ---------------------------------------------------------------------------

deploy_backend() {
  log_info "=== Backend Canary Deployment ==="
  log_info "Commit SHA: $COMMIT_SHA"

  # Validate AWS environment variables
  if [[ -z "${AWS_REGION:-}" ]] || [[ -z "${ECS_CLUSTER:-}" ]] || [[ -z "${ECS_SERVICE:-}" ]] || [[ -z "${ALB_LISTENER_ARN:-}" ]]; then
    log_error "Missing AWS environment variables (AWS_REGION, ECS_CLUSTER, ECS_SERVICE, ALB_LISTENER_ARN)"
    exit 1
  fi
  if ! command -v aws >/dev/null; then
    log_error "AWS CLI not installed"
    exit 1
  fi

  # Determine current task definition and target group
  OLD_TASK_DEF=$(aws ecs describe-services --cluster "$ECS_CLUSTER" --services "$ECS_SERVICE" --region "$AWS_REGION" --query 'services[0].taskDefinition' --output text)
  OLD_TG_ARN=$(aws elbv2 describe-listeners --listener-arns "$ALB_LISTENER_ARN" --region "$AWS_REGION" --query 'Listeners[0].DefaultActions[0].ForwardConfig.TargetGroups[0].TargetGroupArn' --output text)

  log_ok "Current task definition: $OLD_TASK_DEF"
  log_ok "Current target group: $OLD_TG_ARN"

  # Register new task definition (reuse existing definition, replace image tag if needed)
  # Assuming Docker image tag is the commit SHA and already pushed by CI.
  IMAGE_URI="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/finchippay-backend:${COMMIT_SHA}"
  log_info "Registering new task definition with image $IMAGE_URI"
  # Fetch existing definition JSON and replace image URI
  TASK_DEF_JSON=$(aws ecs describe-task-definition --task-definition "$OLD_TASK_DEF" --region "$AWS_REGION" --query 'taskDefinition' --output json)
  NEW_TASK_DEF_JSON=$(echo "$TASK_DEF_JSON" | jq --arg img "$IMAGE_URI" '.containerDefinitions[0].image = $img')
  NEW_TASK_DEF=$(aws ecs register-task-definition --cli-input-json "$NEW_TASK_DEF_JSON" --region "$AWS_REGION" --query 'taskDefinition.taskDefinitionArn' --output text)
  log_ok "New task definition: $NEW_TASK_DEF"

  # Create new target group for canary
  VPC_ID=$(aws elbv2 describe-listeners --listener-arns "$ALB_LISTENER_ARN" --region "$AWS_REGION" --query 'Listeners[0].LoadBalancerArn' --output text | xargs -I{} aws elbv2 describe-load-balancers --load-balancer-arns {} --region "$AWS_REGION" --query 'LoadBalancers[0].VpcId' --output text)
  CANARY_TG_NAME="finchippay-canary-${COMMIT_SHA:0:8}"
  CANARY_TG_ARN=$(aws elbv2 create-target-group --name "$CANARY_TG_NAME" --protocol HTTP --port 4000 --vpc-id "$VPC_ID" --target-type ip --health-check-path /health --region "$AWS_REGION" --query 'TargetGroups[0].TargetGroupArn' --output text)
  log_ok "Canary target group created: $CANARY_TG_ARN"

  # Create canary ECS service linked to the new target group
  # Retrieve subnets and security groups from existing service
  SERVICE_DESC=$(aws ecs describe-services --cluster "$ECS_CLUSTER" --services "$ECS_SERVICE" --region "$AWS_REGION" --query 'services[0]')
  SUBNETS=$(echo "$SERVICE_DESC" | jq -r '.networkConfiguration.awsvpcConfiguration.subnets | join(",")')
  SGROUPS=$(echo "$SERVICE_DESC" | jq -r '.networkConfiguration.awsvpcConfiguration.securityGroups | join(",")')
  ASSIGN_PUBLIC_IP=$(echo "$SERVICE_DESC" | jq -r '.networkConfiguration.awsvpcConfiguration.assignPublicIp')
  CONTAINER_NAME=$(echo "$SERVICE_DESC" | jq -r '.loadBalancers[0].containerName')
  CONTAINER_PORT=$(echo "$SERVICE_DESC" | jq -r '.loadBalancers[0].containerPort')
  CANARY_SERVICE_NAME="${ECS_SERVICE}-canary-${COMMIT_SHA:0:8}"
  aws ecs create-service \
    --cluster "$ECS_CLUSTER" \
    --service-name "$CANARY_SERVICE_NAME" \
    --task-definition "$NEW_TASK_DEF" \
    --desired-count 1 \
    --launch-type FARGATE \
    --network-configuration "awsvpcConfiguration={subnets=[$SUBNETS],securityGroups=[$SGROUPS],assignPublicIp=$ASSIGN_PUBLIC_IP}" \
    --load-balancers "targetGroupArn=$CANARY_TG_ARN,containerName=$CONTAINER_NAME,containerPort=$CONTAINER_PORT" \
    --region "$AWS_REGION"
  log_ok "Canary ECS service created: $CANARY_SERVICE_NAME"

  # Helper to adjust traffic weights and run monitor
  shift_traffic() {
    local weight=$1
    log_info "Shifting traffic: $weight% to canary"
    aws elbv2 modify-listener \
      --listener-arn "$ALB_LISTENER_ARN" \
      --region "$AWS_REGION" \
      --default-actions "[{\"Type\":\"forward\",\"ForwardConfig\":{\"TargetGroups\":[{\"TargetGroupArn\":\"$OLD_TG_ARN\",\"Weight\":$((100 - weight))},{\"TargetGroupArn\":\"$CANARY_TG_ARN\",\"Weight\":$weight}]}}]"
    log_ok "Traffic shifted"
    # Run monitor for this stage
    if ! node "$CANARY_MONITOR" --duration "$MONITOR_DURATION_MINUTES" --health-url "$HEALTH_CHECK_URL" --stage "backend-${weight}%"; then
      log_error "Degradation detected at ${weight}%"
      bash "$ROLLBACK_SCRIPT" backend "$COMMIT_SHA"
      exit 1
    fi
    log_ok "Canary healthy at ${weight}%"
  }

  # Stage 1 – initial weight
  shift_traffic "$CANARY_WEIGHT_START"

  # Stage 2 – intermediate weight
  shift_traffic "$CANARY_WEIGHT_STEP"

  # Stage 3 – full rollout
  shift_traffic "$CANARY_WEIGHT_FINAL"

  # Cleanup old target group after drain
  log_info "Waiting for connection drain before deleting old TG..."
  sleep 30
  aws elbv2 delete-target-group --target-group-arn "$OLD_TG_ARN" --region "$AWS_REGION" || log_warn "Failed to delete old TG (may still have connections)"
  log_ok "Old target group removed"

  # Update main service to new task definition and delete canary service
  log_info "Updating main ECS service to new task definition"
  aws ecs update-service --cluster "$ECS_CLUSTER" --service "$ECS_SERVICE" --task-definition "$NEW_TASK_DEF" --region "$AWS_REGION" --force-new-deployment
  log_ok "Main service updated"

  log_info "Deleting canary ECS service"
  aws ecs update-service --cluster "$ECS_CLUSTER" --service "$CANARY_SERVICE_NAME" --desired-count 0 --region "$AWS_REGION" || true
  aws ecs delete-service --cluster "$ECS_CLUSTER" --service "$CANARY_SERVICE_NAME" --region "$AWS_REGION" || true
  log_ok "Canary service removed"

  log_ok "Backend canary deployment complete"
}

# ---------------------------------------------------------------------------
# Main execution
# ---------------------------------------------------------------------------
case "$TARGET" in
  frontend)
    deploy_frontend
    ;;
  backend)
    deploy_backend
    ;;
  *)
    usage
    ;;
esac

exit 0
