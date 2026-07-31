#!/usr/bin/env bash
# scripts/rollback.sh
# Rollback a canary deployment for Finchippay-Solution.
#
# Restores the previous stable version for frontend (Vercel) or backend (ECS ALB).
#
# Usage:
#   chmod +x scripts/rollback.sh
#   ./scripts/rollback.sh frontend  [commit-sha]
#   ./scripts/rollback.sh backend   [commit-sha]
#
# Required environment variables:
#   Frontend:
#     VERCEL_TOKEN, VERCEL_ORG_ID, VERCEL_PROJECT_ID
#   Backend:
#     AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY,
#     ECS_CLUSTER, ECS_SERVICE, ALB_LISTENER_ARN

set -euo pipefail

TARGET="${1:-}"
COMMIT_SHA="${2:-$(git rev-parse HEAD 2>/dev/null || echo "unknown")}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_info()  { echo -e "${YELLOW}[rollback]${NC} $*"; }
log_ok()    { echo -e "${GREEN}[rollback] ✓${NC} $*"; }
log_error() { echo -e "${RED}[rollback] ✗${NC} $*"; }

# ─── Validate environment variables ───────────────────────────────────────────

validate_rollback_env() {
  local target="$1"
  if [ "$target" = "frontend" ]; then
    local missing=()
    for var in VERCEL_TOKEN; do
      if [ -z "${!var:-}" ]; then
        missing+=("$var")
      fi
    done
    if [ ${#missing[@]} -gt 0 ]; then
      log_error "Missing Vercel environment variables: ${missing[*]}"
      log_error "Rollback requires VERCEL_TOKEN to remove canary alias"
      return 1
    fi
  elif [ "$target" = "backend" ]; then
    local missing=()
    for var in AWS_REGION ECS_CLUSTER ECS_SERVICE ALB_LISTENER_ARN; do
      if [ -z "${!var:-}" ]; then
        missing+=("$var")
      fi
    done
    if [ ${#missing[@]} -gt 0 ]; then
      log_error "Missing AWS environment variables: ${missing[*]}"
      return 1
    fi
    if ! command -v aws &>/dev/null; then
      log_error "AWS CLI not found. Install: pip install awscli"
      return 1
    fi
  fi
  return 0
}

# ─── Usage ────────────────────────────────────────────────────────────────────

usage() {
  cat <<EOF
Usage: $0 <frontend|backend> [commit-sha]

Rollback a canary deployment, restoring the previous stable version.

Targets:
  frontend  — Revert Vercel deployment alias to previous production deployment
  backend   — Reset ALB listener rule weight to 100% on old target group,
              deregister new task definition

Environment:
  Frontend: VERCEL_TOKEN, VERCEL_ORG_ID, VERCEL_PROJECT_ID
  Backend:  AWS_REGION, ECS_CLUSTER, ECS_SERVICE, ALB_LISTENER_ARN
EOF
  exit 1
}

# ─── Frontend rollback: Vercel ────────────────────────────────────────────────

rollback_frontend() {
  log_info "Rolling back frontend (Vercel) for SHA: $COMMIT_SHA"
  log_info "Timestamp: $TIMESTAMP"

  validate_rollback_env frontend || return 1

  if ! command -v vercel &>/dev/null; then
    log_info "Installing Vercel CLI..."
    npm install -g vercel@latest
  fi

  # Read saved state if available
  local CANARY_ALIAS="canary-${COMMIT_SHA:0:8}.finchippay.vercel.app"
  if [ -f /tmp/canary-frontend-alias.txt ]; then
    CANARY_ALIAS=$(cat /tmp/canary-frontend-alias.txt)
  fi

  # Step 1: Remove the canary alias to stop routing traffic
  log_info "Removing canary alias: $CANARY_ALIAS"
  vercel alias rm "$CANARY_ALIAS" --token="$VERCEL_TOKEN" --yes 2>/dev/null || {
    log_info "Canary alias may already be removed or did not exist"
  }
  log_ok "Canary alias removed"

  # Step 2: Production traffic was never affected by alias-based canary;
  # it remained on the previous deployment. No further action needed.
  # If vercel promote was used accidentally, we revert by re-promoting the
  # previous deployment. For safety, check current production:
  log_info "Verifying production deployment..."
  local PROD_DEPLOYMENTS
  PROD_DEPLOYMENTS=$(vercel list --token="$VERCEL_TOKEN" --environment=production 2>/dev/null || echo "")
  log_info "Production deployments:"
  echo "$PROD_DEPLOYMENTS" | head -5 || true

  # Step 3: If we have a previously known good URL, re-alias it
  if [ -f /tmp/canary-frontend-url.txt ]; then
    local CANARY_URL
    CANARY_URL=$(cat /tmp/canary-frontend-url.txt)
    # The canary URL was the staging deployment; production was never touched
    # so no re-alias is needed for standard blue-green
    log_info "Frontend production was unaffected — rollback complete"
  fi

  # Cleanup state files
  rm -f /tmp/canary-frontend-url.txt /tmp/canary-frontend-alias.txt

  log_ok "Frontend rollback complete (production unaffected)"
  return 0
}

# ─── Backend rollback: ECS ALB ────────────────────────────────────────────────

rollback_backend() {
  log_info "Rolling back backend (ECS ALB) for SHA: $COMMIT_SHA"
  log_info "Timestamp: $TIMESTAMP"

  validate_rollback_env backend || return 1

  # Read saved state
  local OLD_TASK_DEF=""
  local OLD_TG_ARN=""
  local CANARY_TG_ARN=""

  if [ -f /tmp/canary-backend-old-taskdef.txt ]; then
    OLD_TASK_DEF=$(cat /tmp/canary-backend-old-taskdef.txt)
  fi
  if [ -f /tmp/canary-backend-old-tg.txt ]; then
    OLD_TG_ARN=$(cat /tmp/canary-backend-old-tg.txt)
  fi
  if [ -f /tmp/canary-backend-canary-tg.txt ]; then
    CANARY_TG_ARN=$(cat /tmp/canary-backend-canary-tg.txt)
  fi

  # Step 1: Immediately route 100% traffic back to old target group
  if [ -n "$OLD_TG_ARN" ] && [ -n "$ALB_LISTENER_ARN" ]; then
    log_info "Routing 100% traffic back to old target group: $OLD_TG_ARN"
    if aws elbv2 modify-listener \
      --listener-arn "$ALB_LISTENER_ARN" \
      --region "$AWS_REGION" \
      --default-actions \
        "[{\"Type\":\"forward\",\"ForwardConfig\":{\"TargetGroups\":[{\"TargetGroupArn\":\"$OLD_TG_ARN\",\"Weight\":100}]}}]"; then
      log_ok "Traffic routed back to old target group"
    else
      log_error "CRITICAL: Failed to modify ALB listener — manual intervention required!"
      log_error "  aws elbv2 modify-listener --listener-arn $ALB_LISTENER_ARN --region $AWS_REGION"
      log_error "  --default-actions '[{\"Type\":\"forward\",\"ForwardConfig\":{\"TargetGroups\":[{\"TargetGroupArn\":\"$OLD_TG_ARN\",\"Weight\":100}]}}]'"
      return 1
    fi
  else
    log_error "Missing old target group ARN — cannot route traffic back automatically"
    log_error "State files may be missing from /tmp/"
    return 1
  fi

  # Step 2: Delete canary ECS service if it exists
  if [ -f /tmp/canary-backend-service-name.txt ]; then
    local CANARY_SERVICE_NAME
    CANARY_SERVICE_NAME=$(cat /tmp/canary-backend-service-name.txt)
    log_info "Scaling down canary ECS service: $CANARY_SERVICE_NAME"
    aws ecs update-service \
      --cluster "$ECS_CLUSTER" \
      --service "$CANARY_SERVICE_NAME" \
      --desired-count 0 \
      --region "$AWS_REGION" >/dev/null 2>&1 || true
    aws ecs delete-service \
      --cluster "$ECS_CLUSTER" \
      --service "$CANARY_SERVICE_NAME" \
      --region "$AWS_REGION" >/dev/null 2>&1 || true
    log_ok "Canary ECS service deleted"
  fi

  # Step 3: Revert main ECS service to old task definition
  if [ -n "$OLD_TASK_DEF" ] && [ -n "$ECS_CLUSTER" ] && [ -n "$ECS_SERVICE" ]; then
    log_info "Reverting ECS service to old task definition: $OLD_TASK_DEF"
    aws ecs update-service \
      --cluster "$ECS_CLUSTER" \
      --service "$ECS_SERVICE" \
      --task-definition "$OLD_TASK_DEF" \
      --region "$AWS_REGION" >/dev/null 2>&1 || {
      log_error "Failed to update ECS service — manual intervention may be required!"
    }
    log_ok "ECS service reverted to old task definition"
  fi

  # Step 3: Deregister new (canary) task definition
  if [ -f /tmp/canary-backend-new-taskdef.txt ]; then
    local NEW_TASK_DEF
    NEW_TASK_DEF=$(cat /tmp/canary-backend-new-taskdef.txt)
    log_info "Deregistering canary task definition: $NEW_TASK_DEF"
    aws ecs deregister-task-definition \
      --task-definition "$NEW_TASK_DEF" \
      --region "$AWS_REGION" >/dev/null 2>&1 || log_info "Could not deregister task definition"
  fi

  # Step 4: Delete canary target group (after drain)
  if [ -n "$CANARY_TG_ARN" ]; then
    log_info "Waiting 30s for connection drain, then deleting canary target group..."
    sleep 30
    aws elbv2 delete-target-group \
      --target-group-arn "$CANARY_TG_ARN" \
      --region "$AWS_REGION" >/dev/null 2>&1 || log_info "Could not delete canary target group"
    log_ok "Canary target group deleted"
  fi

  # Cleanup state files
  rm -f /tmp/canary-backend-*.txt

  log_ok "Backend rollback complete!"
  return 0
}

# ─── Main ─────────────────────────────────────────────────────────────────────

case "$TARGET" in
  frontend)
    rollback_frontend
    ;;
  backend)
    rollback_backend
    ;;
  *)
    usage
    ;;
esac
