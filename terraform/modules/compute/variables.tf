# terraform/modules/compute/variables.tf

variable "project" {
  description = "Project name used in resource naming and tagging"
  type        = string
}

variable "environment" {
  description = "Deployment environment (dev, staging, prod)"
  type        = string
  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "environment must be one of: dev, staging, prod."
  }
}

variable "aws_region" {
  description = "AWS region"
  type        = string
}

variable "aws_account_id" {
  description = "AWS account ID (used for unique S3 bucket names)"
  type        = string
}

# ── Networking inputs (from networking module) ────────────────────────────────

variable "vpc_id" {
  description = "VPC ID"
  type        = string
}

variable "public_subnet_ids" {
  description = "Public subnet IDs for the ALB"
  type        = list(string)
}

variable "private_subnet_ids" {
  description = "Private subnet IDs for ECS tasks"
  type        = list(string)
}

variable "alb_security_group_id" {
  description = "Security group ID for the ALB"
  type        = string
}

variable "ecs_tasks_security_group_id" {
  description = "Security group ID for ECS tasks"
  type        = string
}

# ── DNS / TLS ─────────────────────────────────────────────────────────────────

variable "certificate_arn" {
  description = "ARN of the ACM certificate for HTTPS"
  type        = string
}

# ── Container images ──────────────────────────────────────────────────────────

variable "backend_image_tag" {
  description = "Docker image tag for the backend container"
  type        = string
  default     = "latest"
}

variable "frontend_image_tag" {
  description = "Docker image tag for the frontend container"
  type        = string
  default     = "latest"
}

# ── Backend service ───────────────────────────────────────────────────────────

variable "backend_cpu" {
  description = "CPU units for the backend task (256, 512, 1024, 2048, 4096)"
  type        = number
  default     = 512
}

variable "backend_memory" {
  description = "Memory (MiB) for the backend task"
  type        = number
  default     = 1024
}

variable "backend_port" {
  description = "Port the backend container listens on"
  type        = number
  default     = 4000
}

variable "backend_desired_count" {
  description = "Desired number of backend tasks"
  type        = number
  default     = 2
}

variable "backend_min_count" {
  description = "Minimum number of backend tasks for auto-scaling"
  type        = number
  default     = 1
}

variable "backend_max_count" {
  description = "Maximum number of backend tasks for auto-scaling"
  type        = number
  default     = 10
}

# ── Frontend service ──────────────────────────────────────────────────────────

variable "frontend_cpu" {
  description = "CPU units for the frontend task (256, 512, 1024, 2048, 4096)"
  type        = number
  default     = 256
}

variable "frontend_memory" {
  description = "Memory (MiB) for the frontend task"
  type        = number
  default     = 512
}

variable "frontend_port" {
  description = "Port the frontend container listens on"
  type        = number
  default     = 80
}

variable "frontend_desired_count" {
  description = "Desired number of frontend tasks"
  type        = number
  default     = 2
}

variable "frontend_min_count" {
  description = "Minimum number of frontend tasks for auto-scaling"
  type        = number
  default     = 1
}

variable "frontend_max_count" {
  description = "Maximum number of frontend tasks for auto-scaling"
  type        = number
  default     = 6
}

# ── Application config ────────────────────────────────────────────────────────

variable "stellar_network" {
  description = "Stellar network (testnet or mainnet)"
  type        = string
  default     = "mainnet"
  validation {
    condition     = contains(["testnet", "mainnet"], var.stellar_network)
    error_message = "stellar_network must be testnet or mainnet."
  }
}

variable "horizon_url" {
  description = "Stellar Horizon server URL"
  type        = string
  default     = "https://horizon.stellar.org"
}

variable "allowed_origins" {
  description = "Comma-separated list of allowed CORS origins for the backend"
  type        = string
}

variable "backend_api_url" {
  description = "Public URL of the backend API (used as NEXT_PUBLIC_API_URL)"
  type        = string
}

variable "secrets_arn_prefix" {
  description = "Prefix for Secrets Manager secret ARNs (e.g. arn:aws:secretsmanager:us-east-1:123456789:secret:prod-finchippay)"
  type        = string
}

# ── Observability ─────────────────────────────────────────────────────────────

variable "enable_container_insights" {
  description = "Enable ECS Container Insights (CloudWatch metrics)"
  type        = bool
  default     = true
}

variable "log_retention_days" {
  description = "CloudWatch log retention in days"
  type        = number
  default     = 30
}

variable "tags" {
  description = "Additional tags to apply to all resources"
  type        = map(string)
  default     = {}
}
