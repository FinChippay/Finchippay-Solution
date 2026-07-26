# terraform/variables.tf
# All variables for the root Finchippay Terraform module.
# Environment-specific values are supplied via environments/*/main.tf.

# ── Core ──────────────────────────────────────────────────────────────────────

variable "project" {
  description = "Project name, used as a prefix in resource names and tags"
  type        = string
  default     = "finchippay"
}

variable "environment" {
  description = "Deployment environment"
  type        = string
  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "environment must be dev, staging, or prod."
  }
}

variable "aws_region" {
  description = "AWS region to deploy infrastructure into"
  type        = string
  default     = "us-east-1"
}

variable "aws_account_id" {
  description = "AWS account ID (used for S3 bucket naming and IAM policies)"
  type        = string
}

# ── Networking ────────────────────────────────────────────────────────────────

variable "availability_zones" {
  description = "List of Availability Zones to use (1 for dev, 2 for staging, 3 for prod)"
  type        = list(string)
}

variable "vpc_cidr" {
  description = "CIDR block for the VPC"
  type        = string
  default     = "10.0.0.0/16"
}

variable "public_subnet_cidrs" {
  description = "CIDR blocks for public subnets (one per AZ)"
  type        = list(string)
}

variable "private_subnet_cidrs" {
  description = "CIDR blocks for private subnets (one per AZ)"
  type        = list(string)
}

variable "database_subnet_cidrs" {
  description = "CIDR blocks for isolated database subnets (one per AZ)"
  type        = list(string)
}

variable "single_nat_gateway" {
  description = "Use a single shared NAT gateway (cost saving for non-prod)"
  type        = bool
  default     = false
}

variable "enable_flow_logs" {
  description = "Enable VPC flow logs to CloudWatch"
  type        = bool
  default     = true
}

# ── Compute ───────────────────────────────────────────────────────────────────

variable "backend_cpu" {
  description = "CPU units for the backend Fargate task"
  type        = number
  default     = 512
}

variable "backend_memory" {
  description = "Memory (MiB) for the backend Fargate task"
  type        = number
  default     = 1024
}

variable "frontend_cpu" {
  description = "CPU units for the frontend Fargate task"
  type        = number
  default     = 256
}

variable "frontend_memory" {
  description = "Memory (MiB) for the frontend Fargate task"
  type        = number
  default     = 512
}

variable "backend_desired_count" {
  description = "Desired number of backend task replicas"
  type        = number
  default     = 2
}

variable "frontend_desired_count" {
  description = "Desired number of frontend task replicas"
  type        = number
  default     = 2
}

variable "backend_min_count" {
  description = "Minimum backend tasks for auto-scaling"
  type        = number
  default     = 1
}

variable "backend_max_count" {
  description = "Maximum backend tasks for auto-scaling"
  type        = number
  default     = 10
}

variable "frontend_min_count" {
  description = "Minimum frontend tasks for auto-scaling"
  type        = number
  default     = 1
}

variable "frontend_max_count" {
  description = "Maximum frontend tasks for auto-scaling"
  type        = number
  default     = 6
}

variable "backend_image_tag" {
  description = "Docker image tag for the backend (defaults to 'latest')"
  type        = string
  default     = "latest"
}

variable "frontend_image_tag" {
  description = "Docker image tag for the frontend (defaults to 'latest')"
  type        = string
  default     = "latest"
}

variable "log_retention_days" {
  description = "CloudWatch log retention period in days"
  type        = number
  default     = 30
}

# ── Database ──────────────────────────────────────────────────────────────────

variable "db_instance_class" {
  description = "RDS instance class (e.g. db.t3.micro, db.t3.medium, db.r6g.large)"
  type        = string
  default     = "db.t3.micro"
}

variable "db_allocated_storage" {
  description = "Initial RDS storage allocation in GB"
  type        = number
  default     = 20
}

variable "db_multi_az" {
  description = "Enable RDS Multi-AZ for high availability"
  type        = bool
  default     = false
}

variable "db_backup_retention" {
  description = "RDS automated backup retention in days"
  type        = number
  default     = 7
}

variable "db_performance_insights" {
  description = "Enable RDS Performance Insights"
  type        = bool
  default     = false
}

# ── Cache ─────────────────────────────────────────────────────────────────────

variable "redis_node_type" {
  description = "ElastiCache node type (e.g. cache.t3.micro, cache.r6g.large)"
  type        = string
  default     = "cache.t3.micro"
}

variable "redis_num_clusters" {
  description = "Number of Redis cache clusters (1 = primary only)"
  type        = number
  default     = 1
}

variable "redis_multi_az" {
  description = "Enable Multi-AZ for Redis replication group"
  type        = bool
  default     = false
}

# ── DNS ───────────────────────────────────────────────────────────────────────

variable "domain_name" {
  description = "Apex domain name (e.g. finchippay.com)"
  type        = string
}

variable "create_zone" {
  description = "Whether to create a new Route 53 hosted zone (false = use existing)"
  type        = bool
  default     = false
}

variable "existing_zone_id" {
  description = "ID of an existing Route 53 hosted zone (used when create_zone = false)"
  type        = string
  default     = ""
}

# ── Application ───────────────────────────────────────────────────────────────

variable "stellar_network" {
  description = "Stellar network: testnet or mainnet"
  type        = string
  default     = "testnet"
  validation {
    condition     = contains(["testnet", "mainnet"], var.stellar_network)
    error_message = "stellar_network must be testnet or mainnet."
  }
}

variable "horizon_url" {
  description = "Stellar Horizon server URL"
  type        = string
  default     = "https://horizon-testnet.stellar.org"
}

variable "allowed_origins" {
  description = "Comma-separated CORS-allowed origins for the backend API"
  type        = string
}

variable "secrets_arn_prefix" {
  description = "Prefix for AWS Secrets Manager ARNs (e.g. arn:aws:secretsmanager:us-east-1:123:secret:dev-finchippay)"
  type        = string
}

# ── Tags ──────────────────────────────────────────────────────────────────────

variable "tags" {
  description = "Additional tags applied to all resources"
  type        = map(string)
  default     = {}
}
