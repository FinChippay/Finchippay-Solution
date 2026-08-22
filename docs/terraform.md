# Terraform Infrastructure — Finchippay

This document explains the Terraform modules that provision Finchippay's production infrastructure on **AWS** (ECS Fargate) and walks through the full lifecycle from first-time setup to tear-down. GCP (Cloud Run) is planned for a future iteration.

## Architecture

```
terraform/
├── main.tf                    # Root module — wires all child modules together
├── variables.tf               # All input variables with defaults and descriptions
├── outputs.tf                 # Root outputs (backend_url, endpoints, etc.)
├── providers.tf               # AWS + random providers, S3/DynamoDB state backend
├── terraform.tfvars.example   # Copy → terraform.tfvars, fill in values
├── modules/
│   ├── networking/            # VPC, public/private subnets, NAT, security groups
│   ├── compute/               # ECS Fargate cluster, tasks, services, ALB, autoscaling
│   ├── database/              # RDS PostgreSQL (subnet group, parameter group)
│   ├── cache/                 # ElastiCache Redis (subnet group, parameter group)
│   └── dns/                   # Route53 hosted zone + ACM certificate
└── environments/
    ├── dev/                   # Small instances, single AZ, no Multi-AZ DB
    ├── staging/               # Medium instances, Multi-AZ DB
    └── prod/                  # Large instances, Multi-AZ DB + Redis, autoscaling
```

### Resource summary

| Module | Resource | Purpose |
|---|---|---|
| networking | `aws_vpc` | Isolated private network |
| networking | `aws_subnet` × 2 | Public (ALB) and private (tasks/data) subnets |
| networking | `aws_nat_gateway` | Outbound internet for private resources |
| networking | `aws_security_group` × 4 | ALB, app tasks, database, Redis |
| compute | `aws_ecs_cluster` | Fargate cluster (Container Insights enabled) |
| compute | `aws_ecs_task_definition` × 2 | Backend + frontend containers |
| compute | `aws_ecs_service` × 2 | Backend + frontend services behind the ALB |
| compute | `aws_lb` + listeners | Application load balancer, `/api/*` → backend, else → frontend |
| compute | `aws_appautoscaling_*` | Target-tracking autoscaling (CPU/memory) |
| compute | `aws_route53_record` | A record aliased to the ALB |
| database | `aws_db_instance` | RDS PostgreSQL 16, Multi-AZ optional |
| database | `aws_db_parameter_group` | `postgres16` parameter group |
| cache | `aws_elasticache_replication_group` | ElastiCache Redis 7, AUTH + encryption |
| dns | `aws_route53_zone` | Hosted zone for the app domain |
| dns | `aws_acm_certificate` | TLS certificate (DNS validation) |

All application and data-plane resources live in **private subnets**. The internet-facing ALB lives in the public subnets; ECS tasks, RDS and ElastiCache are only reachable via the security group chain (ALB → app → database/Redis).

## Prerequisites

- [Terraform](https://developer.hashicorp.com/terraform/install) ≥ 1.6
- An AWS account with credentials configured (`aws configure`), or an OIDC role for CI
- The Finchippay container images published to a registry (ECR, Docker Hub, GHCR)

## Quick start

### 1. Configure variables

```bash
cd terraform/
cp terraform.tfvars.example terraform.tfvars
```

Edit `terraform.tfvars` and at minimum set:

```hcl
environment   = "dev"
backend_image  = "123456789012.dkr.ecr.us-east-1.amazonaws.com/finchippay-backend:latest"
frontend_image = "123456789012.dkr.ecr.us-east-1.amazonaws.com/finchippay-frontend:latest"
```

Everything else has sensible defaults for a single-environment deployment.

### 2. Initialise

```bash
terraform init
```

This downloads the AWS provider (`~> 5.40`) into `.terraform/`.

### 3. Plan

```bash
terraform plan
```

Review the output — it should show resources to be **created** with no errors.

### 4. Apply

```bash
terraform apply
```

Type `yes` when prompted. Provisioning takes roughly 10–15 minutes (RDS and ElastiCache take the longest).

### 5. Retrieve outputs

```bash
terraform output frontend_url
terraform output backend_url
terraform output -json   # all outputs as JSON

# Sensitive outputs require an explicit -raw or -json flag:
terraform output -raw database_connection_url
terraform output -raw redis_connection_url
```

## Deploying an environment (recommended)

Each environment ships its own var file, so a full deployment is a single command:

```bash
# dev
terraform init -backend-config="environments/dev/backend.tfvars"
terraform apply -var-file="environments/dev/dev.tfvars"

# staging
terraform init -backend-config="environments/staging/backend.tfvars"
terraform apply -var-file="environments/staging/staging.tfvars"

# prod
terraform init -backend-config="environments/prod/backend.tfvars"
terraform apply -var-file="environments/prod/prod.tfvars"
```

| Environment | Compute (backend) | Database | Redis | DNS |
|---|---|---|---|---|
| dev | 256 CPU / 512 MiB, ×1 | `db.t3.micro`, single AZ | `cache.t3.micro`, 1 node | off |
| staging | 512 CPU / 1024 MiB, ×1–3 | `db.t3.medium`, Multi-AZ | `cache.t3.medium`, 2 nodes | on |
| prod | 1024 CPU / 2048 MiB, ×2–6 | `db.r6g.large`, Multi-AZ | `cache.r6g.large`, 2 nodes | on |

## Module reference

### `modules/networking`

| Variable | Default | Description |
|---|---|---|
| `vpc_cidr` | — | VPC CIDR block |
| `availability_zones` | — | AZs for the subnets |
| `public_subnet_cidrs` | — | Public subnet CIDRs (ALB) |
| `private_subnet_cidrs` | — | Private subnet CIDRs (tasks, RDS, Redis) |

**Outputs:** `vpc_id`, `public_subnet_ids`, `private_subnet_ids`, `alb_security_group_id`, `app_security_group_id`, `database_security_group_id`, `redis_security_group_id`

### `modules/compute`

| Variable | Default | Description |
|---|---|---|
| `backend_image` / `frontend_image` | — | Container image URIs |
| `backend_cpu` / `backend_memory` | `512` / `1024` | Backend task size |
| `frontend_cpu` / `frontend_memory` | `256` / `512` | Frontend task size |
| `backend_desired_count` | `1` | Desired backend tasks |
| `enable_autoscaling` | `false` | Target-tracking autoscaling (CPU/memory) |
| `create_dns` | `false` | Create A record and terminate TLS on the ALB |
| `domain_name` / `zone_id` / `certificate_arn` | — | DNS + TLS wiring |

**Outputs:** `cluster_id`, `cluster_name`, `alb_dns_name`, `backend_url`, `frontend_url`, `backend_service_name`, `frontend_service_name`, `backend_log_group`, `frontend_log_group`

### `modules/database`

| Variable | Default | Description |
|---|---|---|
| `engine_version` | `16.3` | PostgreSQL version |
| `instance_class` | `db.t3.micro` | RDS instance class |
| `allocated_storage` / `max_allocated_storage` | `20` / `50` | Storage (GiB) + autoscaling cap |
| `multi_az` | `false` | Multi-AZ standby replica |
| `deletion_protection` | `false` | Prevent accidental deletion |

**Outputs:** `endpoint`, `port`, `db_name`, `username`, `password` *(sensitive)*, `connection_url` *(sensitive)*, `secret_arn`

### `modules/cache`

| Variable | Default | Description |
|---|---|---|
| `engine_version` | `7.1` | Redis version |
| `node_type` | `cache.t3.micro` | Node class |
| `num_cache_nodes` | `1` | Node count (2+ enables Multi-AZ failover) |
| `multi_az` | `false` | Automatic failover |

**Outputs:** `primary_endpoint_address`, `primary_endpoint_port`, `auth_token` *(sensitive)*, `connection_url` *(sensitive)*, `replication_group_id`

### `modules/dns`

| Variable | Default | Description |
|---|---|---|
| `domain_name` | — | Public domain |
| `create_zone` | `true` | Create a new hosted zone |
| `zone_id` | `""` | Reuse an existing zone when `create_zone = false` |

**Outputs:** `zone_id`, `zone_name`, `nameservers`, `certificate_arn`

## Remote state (S3 + DynamoDB)

State is stored remotely in S3 with DynamoDB locking via the `backend "s3"` block in `providers.tf`. Bootstrap once per account:

```bash
aws s3api create-bucket --bucket finchippay-tf-state --region us-east-1
aws dynamodb create-table \
  --table-name finchippay-tf-state-lock \
  --attribute-definitions AttributeName=LockID,AttributeType=S \
  --key-schema AttributeName=LockID,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST

# Then initialise with the environment backend:
terraform init -backend-config="environments/prod/backend.tfvars"
```

Each environment stores state under its own key (`finchippay/<env>/terraform.tfstate`). The CI workflow passes these values via `TF_STATE_BUCKET` and `TF_STATE_LOCK_TABLE` secrets.

> **Tip:** use `terraform init -backend=false` for local-only `terraform validate` / `terraform fmt` checks that do not require the state bucket. A full `terraform plan` requires the initialized S3 backend (or the state bucket), as CI performs.

## CI/CD

The `.github/workflows/terraform.yml` workflow:

- **Pull request:** runs `terraform fmt -check`, `terraform validate`, and `terraform plan` (dev), then posts the plan as a PR comment and uploads it as an artifact.
- **Push to `main`:** runs `terraform init` with the S3 backend, `terraform plan`, and `terraform apply` for the **prod** environment behind the `production` GitHub environment (configure required reviewers to gate the apply).
- **Manual dispatch:** `terraform plan` / `apply` / `destroy` against any environment.

AWS access uses OIDC (`aws-actions/configure-aws-credentials`) with the role in the `AWS_ROLE_ARN` secret — no long-lived keys.

## DNS / TLS

When `create_dns = true`:

1. `modules/dns` creates the hosted zone and an ACM certificate validated through DNS records.
2. Point the registrar's NS records to the hosted zone nameservers (`terraform output hosted_zone_nameservers`).
3. `modules/compute` creates a Route53 A record aliased to the ALB and terminates TLS on the HTTPS listener (`443`).
4. HTTP (`80`) requests are redirected to HTTPS.

The backend is served under `/api` and the frontend on `/` of the same domain.

## Tear-down

```bash
terraform destroy -var-file="environments/dev/dev.tfvars"
```

This permanently deletes all provisioned resources. Type `yes` when prompted.

> **Warning**: `terraform destroy` drops the RDS database and ElastiCache cluster and all data in them. The RDS module takes a final snapshot (`<prefix>-db-final-snapshot`) before deletion; take an additional snapshot before tearing down a live environment.

## Security notes

- `database_password`, `database_connection_url`, `redis_auth_token`, and `redis_connection_url` are marked `sensitive = true`. Terraform will not display their values in plan/apply output.
- `terraform.tfvars` and `*.auto.tfvars` are excluded from version control via `.gitignore`. Use environment variables (`TF_VAR_*`) or GitHub secrets in CI/CD.
- Application secrets (JWT secret, `DATABASE_URL`, `REDIS_URL`, CORS origins) are stored in AWS Secrets Manager and injected into the ECS tasks at runtime via the task definition `secrets` block.
- Database and Redis are only reachable from the application security group inside the VPC; neither has a public endpoint.
- ElastiCache is encrypted in transit and at rest; RDS storage is encrypted by default.