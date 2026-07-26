# Terraform Infrastructure — Finchippay-Solution

This document covers the complete AWS infrastructure-as-code setup for Finchippay-Solution, built with [Terraform](https://www.terraform.io/) 1.6+.

## Architecture Overview

```
Internet
   │
   ▼
ALB (HTTPS :443 / HTTP :80→redirect)   ← public subnets
   │                    │
   ▼                    ▼
frontend ECS         backend ECS        ← private subnets
(Next.js, port 80)   (Express, port 4000)
                         │         │
                         ▼         ▼
                        RDS      ElastiCache  ← database subnets
                     (PostgreSQL) (Redis)
```

All ECS tasks run on **Fargate** (serverless, no EC2 management). The ALB terminates TLS, routes `/api/*` and `/federation*` to the backend, and serves everything else to the frontend.

## Directory Layout

```
terraform/
├── modules/
│   ├── networking/          VPC, subnets, IGW, NAT gateways, security groups
│   ├── compute/             ECS cluster + services, ALB, ECR repos, auto-scaling
│   ├── database/            RDS PostgreSQL
│   ├── cache/               ElastiCache Redis
│   └── dns/                 Route 53 hosted zone + ACM certificate
├── environments/
│   ├── dev/                 Single AZ, minimal sizing, testnet
│   ├── staging/             Multi-AZ, medium sizing, testnet
│   └── prod/                Three AZs, large sizing, mainnet, full HA
├── main.tf                  Root module — wires all modules together
├── variables.tf             All root-level variable definitions
├── outputs.tf               Key outputs (URLs, endpoints, ECR URLs, …)
├── providers.tf             Provider + version pins
└── terraform.tfvars.example Example variable values
```

## Module Reference

### networking

Creates the VPC foundation.

| Resource | Description |
|---|---|
| `aws_vpc` | VPC with DNS hostnames enabled |
| `aws_subnet` (public) | One per AZ — ALB, NAT EIPs |
| `aws_subnet` (private) | One per AZ — ECS tasks |
| `aws_subnet` (database) | One per AZ — RDS + Redis |
| `aws_internet_gateway` | Outbound for public subnets |
| `aws_nat_gateway` | Outbound for private subnets (1 shared or 1 per AZ) |
| `aws_security_group` (alb) | Allow :80/:443 inbound from `0.0.0.0/0` |
| `aws_security_group` (ecs_tasks) | Allow :4000/:80 from ALB SG only |
| `aws_security_group` (rds) | Allow :5432 from ECS tasks SG only |
| `aws_security_group` (redis) | Allow :6379 from ECS tasks SG only |
| `aws_flow_log` | VPC flow logs to CloudWatch (optional) |

Key variables: `vpc_cidr`, `availability_zones`, `public/private/database_subnet_cidrs`, `single_nat_gateway`, `enable_flow_logs`

### compute

Creates the application layer.

| Resource | Description |
|---|---|
| `aws_ecs_cluster` | Fargate cluster with Container Insights |
| `aws_ecs_task_definition` (backend) | Express API — cpu/memory configurable |
| `aws_ecs_task_definition` (frontend) | Next.js — cpu/memory configurable |
| `aws_ecs_service` (backend/frontend) | Rolling deployments, circuit-breaker rollback |
| `aws_lb` | Application Load Balancer (public) |
| `aws_lb_listener` (HTTP) | Redirect :80 → :443 |
| `aws_lb_listener` (HTTPS) | TLS termination, routes to target groups |
| `aws_lb_listener_rule` | `/api/*` and `/federation*` → backend |
| `aws_lb_target_group` | Health-checked target groups (IP mode) |
| `aws_ecr_repository` | Separate repos for backend and frontend |
| `aws_appautoscaling_*` | CPU + memory target-tracking auto-scaling |
| `aws_iam_role` (execution) | ECS task execution — ECR pull + Secrets Manager |
| `aws_iam_role` (task) | Runtime IAM — CloudWatch metrics, X-Ray |

Container secrets (`JWT_SECRET`, `DATABASE_URL`, `NEXT_PUBLIC_CONTRACT_ID`) are injected from **AWS Secrets Manager** via ECS secrets integration — they never appear in task environment variables in plaintext.

Key variables: `backend_cpu`, `backend_memory`, `backend_desired/min/max_count`, `stellar_network`, `horizon_url`, `secrets_arn_prefix`

### database

Creates the PostgreSQL RDS instance.

| Resource | Description |
|---|---|
| `aws_db_instance` | PostgreSQL 15, gp3 storage, encrypted at rest |
| `aws_db_subnet_group` | Spans all database subnets |
| `aws_db_parameter_group` | Custom params: SSL forced, slow query log, pg_stat_statements |
| `aws_iam_role` | Enhanced monitoring role |
| `aws_cloudwatch_metric_alarm` | CPU high, connection count high, free storage low |

The master password is managed by RDS/Secrets Manager (`manage_master_user_password = true`). The secret ARN is exported as `database_master_secret_arn`.

Key variables: `instance_class`, `allocated_storage_gb`, `multi_az`, `backup_retention_days`, `enable_performance_insights`

### cache

Creates the ElastiCache Redis cluster.

| Resource | Description |
|---|---|
| `aws_elasticache_replication_group` | Redis 7, TLS + at-rest encryption |
| `aws_elasticache_subnet_group` | Spans all database subnets |
| `aws_elasticache_parameter_group` | `maxmemory-policy`, timeout, keepalive |
| `aws_cloudwatch_metric_alarm` | CPU high, memory high, evictions high |

Key variables: `node_type`, `num_cache_clusters`, `multi_az`, `maxmemory_policy`

### dns

Creates DNS and TLS.

| Resource | Description |
|---|---|
| `aws_route53_zone` | Hosted zone (optional — can reuse existing) |
| `aws_acm_certificate` | SAN cert covering apex + `www` (prod) or `*.env.domain` |
| `aws_route53_record` (validation) | DNS validation records for ACM |
| `aws_acm_certificate_validation` | Waits for cert to become valid |
| `aws_route53_record` (A) | ALB alias records for apex and `www` |
| `aws_route53_health_check` | HTTPS health check on `/health` (prod only) |

Key variables: `domain_name`, `create_zone`, `existing_zone_id`, `alb_dns_name`, `alb_zone_id`

## Environment Configurations

| Setting | dev | staging | prod |
|---|---|---|---|
| AZs | 1 | 2 | 3 |
| NAT gateways | 1 shared | 1 shared | 1 per AZ |
| Backend CPU / Memory | 256 / 512 MiB | 512 / 1024 MiB | 1024 / 2048 MiB |
| Backend replicas | 1 (min 1, max 2) | 2 (min 1, max 4) | 3 (min 2, max 20) |
| RDS instance | db.t3.micro | db.t3.medium | db.r6g.large |
| RDS Multi-AZ | ✗ | ✓ | ✓ |
| RDS backup retention | 1 day | 7 days | 30 days |
| Redis node | cache.t3.micro | cache.t3.small | cache.r6g.large |
| Redis replicas | 0 | 1 | 1 (Multi-AZ) |
| Stellar network | testnet | testnet | mainnet |
| Deletion protection | ✗ | ✗ | ✓ |

## Prerequisites

1. **Terraform 1.6+** — [install](https://developer.hashicorp.com/terraform/install)
2. **AWS CLI** configured with credentials that can assume the deploy role
3. **S3 bucket + DynamoDB table** for remote state (optional but recommended)
4. Domain name registered and optionally a Route 53 hosted zone already created
5. GitHub Actions secrets configured (see [CI/CD](#cicd) below)

## First-Time Deployment

### 1. Bootstrap remote state (optional but recommended)

```bash
# Create the state bucket and lock table once per account
aws s3api create-bucket \
  --bucket finchippay-terraform-state \
  --region us-east-1

aws s3api put-bucket-versioning \
  --bucket finchippay-terraform-state \
  --versioning-configuration Status=Enabled

aws s3api put-bucket-encryption \
  --bucket finchippay-terraform-state \
  --server-side-encryption-configuration \
    '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'

aws dynamodb create-table \
  --table-name finchippay-terraform-locks \
  --attribute-definitions AttributeName=LockID,AttributeType=S \
  --key-schema AttributeName=LockID,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --region us-east-1
```

Then uncomment the `backend "s3"` block in the environment's `main.tf`.

### 2. Deploy dev

```bash
cd terraform/environments/dev
cp terraform.tfvars.example terraform.tfvars
# Edit terraform.tfvars with your domain_name and existing_zone_id

terraform init
terraform plan
terraform apply
```

After `apply`, note the outputs:

```bash
terraform output frontend_url       # https://dev.finchippay.com
terraform output backend_ecr_repository_url
terraform output ecs_cluster_name
```

### 3. Push Docker images to ECR

```bash
# Authenticate Docker with ECR
aws ecr get-login-password --region us-east-1 | \
  docker login --username AWS --password-stdin \
  $(terraform output -raw backend_ecr_repository_url | cut -d/ -f1)

# Build and push backend
docker build -t finchippay-backend ./backend
docker tag finchippay-backend:latest $(terraform output -raw backend_ecr_repository_url):latest
docker push $(terraform output -raw backend_ecr_repository_url):latest

# Build and push frontend
docker build -t finchippay-frontend ./frontend
docker tag finchippay-frontend:latest $(terraform output -raw frontend_ecr_repository_url):latest
docker push $(terraform output -raw frontend_ecr_repository_url):latest
```

### 4. Create Secrets Manager secrets

```bash
# JWT secret
aws secretsmanager create-secret \
  --name dev-finchippay/jwt-secret \
  --secret-string "$(openssl rand -hex 32)"

# Database URL (use the RDS endpoint from terraform output)
aws secretsmanager create-secret \
  --name dev-finchippay/database-url \
  --secret-string "postgresql://finchippay_admin:<password>@$(terraform output -raw database_host):5432/finchippay"

# Soroban contract ID
aws secretsmanager create-secret \
  --name dev-finchippay/contract-id \
  --secret-string "CXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
```

### 5. Deploy staging and prod

```bash
# Staging
cd ../staging
cp terraform.tfvars.example terraform.tfvars && vi terraform.tfvars
terraform init && terraform apply

# Prod (after staging is validated)
cd ../prod
cp terraform.tfvars.example terraform.tfvars && vi terraform.tfvars
terraform init && terraform apply
```

### 6. Update DNS nameservers (if a new zone was created)

```bash
terraform output zone_name_servers
# Copy the 4 nameservers to your domain registrar's NS records
```

## CI/CD

The workflow at `.github/workflows/terraform.yml` provides:

| Job | Trigger | Description |
|---|---|---|
| `validate` | PR or push to main | `terraform fmt -check` + `terraform validate` |
| `plan-dev` | PR | Plans dev, posts output as PR comment |
| `plan-staging` | PR | Plans staging, posts output as PR comment |
| `plan-prod` | PR | Plans prod, posts output as PR comment |
| `apply-dev` | Push to `main` | Auto-applies dev |
| `apply-staging` | After `apply-dev` succeeds | Auto-applies staging |
| `apply-prod` | `workflow_dispatch` only | Manual apply with GitHub Environment approval gate |

### Required GitHub Secrets

| Secret | Description |
|---|---|
| `AWS_ROLE_DEV` | IAM role ARN for dev deployments (OIDC) |
| `AWS_ROLE_STAGING` | IAM role ARN for staging deployments (OIDC) |
| `AWS_ROLE_PROD` | IAM role ARN for prod deployments (OIDC) |
| `AWS_REGION` | AWS region (e.g. `us-east-1`) |
| `DOMAIN_NAME` | Apex domain (e.g. `finchippay.com`) |
| `ROUTE53_ZONE_ID` | Existing Route 53 zone ID |

### OIDC Setup (recommended over long-lived keys)

```bash
# Create an OIDC identity provider for GitHub Actions in your AWS account
aws iam create-open-id-connect-provider \
  --url https://token.actions.githubusercontent.com \
  --client-id-list sts.amazonaws.com \
  --thumbprint-list 6938fd4d98bab03faadb97b34396831e3780aea1

# Then create an IAM role with a trust policy scoped to your repo
# See: https://docs.github.com/en/actions/deployment/security-hardening-your-deployments/configuring-openid-connect-in-amazon-web-services
```

## Destroying Infrastructure

```bash
# Never destroy prod without explicit approval
cd terraform/environments/dev
terraform destroy
```

Production deletion protection is enabled on the ALB and RDS instance. You must disable it first:

```bash
# Temporarily disable deletion protection before destroy
terraform apply -var='...' # with deletion_protection overridden
terraform destroy
```

## Secrets Management

Secrets are never stored in Terraform state or task environment variables. The pattern is:

1. Store secrets in **AWS Secrets Manager** under path `<env>-finchippay/<secret-name>`
2. Reference them in the ECS task definition via the `secrets` block
3. ECS injects them as environment variables at task startup only

Required secrets per environment:

| Path | Used by |
|---|---|
| `<env>-finchippay/jwt-secret` | Backend — SEP-0010 JWT signing |
| `<env>-finchippay/database-url` | Backend — PostgreSQL connection |
| `<env>-finchippay/contract-id` | Frontend — Soroban contract ID |

## Monitoring

All services emit metrics to CloudWatch. Key alarms created by the modules:

| Alarm | Threshold | Service |
|---|---|---|
| Backend CPU high | > 85% for 4 min | ECS |
| ALB 5XX errors | > 10/min | ALB |
| RDS CPU high | > 80% for 10 min | RDS |
| RDS connections high | > 80% of max | RDS |
| RDS storage low | < 20% remaining | RDS |
| Redis CPU high | > 80% for 10 min | ElastiCache |
| Redis memory high | > 85% for 10 min | ElastiCache |
| Redis evictions high | > 100 in 5 min | ElastiCache |

VPC flow logs are enabled in staging and prod for network-level audit trails.

## Troubleshooting

**ECS tasks failing health checks**
- Check `/health` endpoint responds with `200` locally: `curl http://localhost:4000/health`
- Review task logs: `aws logs tail /ecs/finchippay-dev/backend --follow`

**Certificate stuck in `PENDING_VALIDATION`**
- Ensure the DNS validation records were created in the correct Route 53 zone
- Check: `aws acm describe-certificate --certificate-arn <arn>`

**`terraform plan` shows destroy on ECR repos**
- ECR repos use `MUTABLE` tags. Do not remove or rename repos with running services.

**RDS connection refused from ECS**
- Confirm the ECS task's security group is the source of the RDS security group rule
- Check subnet routing — database subnets must have the correct route table association
