# ─── Project / naming ─────────────────────────────────────────────────────────

variable "project_name" {
  description = "Slug used to prefix every cloud resource name."
  type        = string
  default     = "finchippay"
}

variable "environment" {
  description = "Deployment environment. One of: dev, staging, prod."
  type        = string

  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "environment must be one of 'dev', 'staging', 'prod'."
  }
}

variable "aws_region" {
  description = "AWS region for all resources."
  type        = string
  default     = "us-east-1"
}

variable "tags" {
  description = "Additional tags applied to all resources."
  type        = map(string)
  default     = {}
}

# ─── Networking ───────────────────────────────────────────────────────────────

variable "vpc_cidr" {
  description = "CIDR block for the VPC."
  type        = string
  default     = "10.0.0.0/16"
}

variable "availability_zones" {
  description = "Availability zones to deploy into (one per subnet CIDR)."
  type        = list(string)
  default     = ["us-east-1a", "us-east-1b"]
}

variable "public_subnet_cidrs" {
  description = "CIDR blocks for the public subnets (ALB)."
  type        = list(string)
  default     = ["10.0.1.0/24", "10.0.2.0/24"]
}

variable "private_subnet_cidrs" {
  description = "CIDR blocks for the private subnets (ECS, RDS, ElastiCache)."
  type        = list(string)
  default     = ["10.0.11.0/24", "10.0.12.0/24"]
}

# ─── DNS / HTTPS ──────────────────────────────────────────────────────────────

variable "domain_name" {
  description = "Public domain name for the deployment (e.g. finchippay.io)."
  type        = string
  default     = "finchippay.example.com"
}

variable "create_dns" {
  description = "Create the Route53 A record and provision an ACM certificate for HTTPS."
  type        = bool
  default     = false
}

variable "create_hosted_zone" {
  description = "Create a new Route53 hosted zone (false to reuse an existing zone via hosted_zone_id)."
  type        = bool
  default     = true
}

variable "hosted_zone_id" {
  description = "ID of an existing Route53 hosted zone (required when create_hosted_zone is false)."
  type        = string
  default     = ""
}

# ─── Compute (ECS Fargate) ────────────────────────────────────────────────────

variable "backend_image" {
  description = "Container image URI for the backend API service."
  type        = string
}

variable "frontend_image" {
  description = "Container image URI for the frontend service."
  type        = string
}

variable "backend_cpu" {
  description = "CPU units for the backend task (512 = 0.5 vCPU, 1024 = 1 vCPU)."
  type        = string
  default     = "512"
}

variable "backend_memory" {
  description = "Memory (MiB) for the backend task."
  type        = string
  default     = "1024"
}

variable "frontend_cpu" {
  description = "CPU units for the frontend task."
  type        = string
  default     = "256"
}

variable "frontend_memory" {
  description = "Memory (MiB) for the frontend task."
  type        = string
  default     = "512"
}

variable "backend_desired_count" {
  description = "Desired number of backend tasks."
  type        = number
  default     = 1
}

variable "backend_min_capacity" {
  description = "Minimum backend task count (autoscaling floor)."
  type        = number
  default     = 1
}

variable "backend_max_capacity" {
  description = "Maximum backend task count (autoscaling ceiling)."
  type        = number
  default     = 4
}

variable "frontend_desired_count" {
  description = "Desired number of frontend tasks."
  type        = number
  default     = 1
}

variable "frontend_min_capacity" {
  description = "Minimum frontend task count."
  type        = number
  default     = 1
}

variable "frontend_max_capacity" {
  description = "Maximum frontend task count."
  type        = number
  default     = 4
}

variable "enable_autoscaling" {
  description = "Enable target-tracking autoscaling on the ECS services."
  type        = bool
  default     = false
}

# ─── Application configuration ────────────────────────────────────────────────

variable "allowed_origins" {
  description = "Comma-separated list of allowed CORS origins."
  type        = string
  default     = "https://finchippay.example.com"
}

variable "stellar_network" {
  description = "Stellar network to connect to (testnet or mainnet)."
  type        = string
  default     = "testnet"
}

variable "horizon_url" {
  description = "Stellar Horizon API URL."
  type        = string
  default     = "https://horizon-testnet.stellar.org"
}

variable "turrets_evaluation_interval_ms" {
  description = "Interval in milliseconds between Turrets evaluation runs."
  type        = string
  default     = "60000"
}

# ─── Database (RDS PostgreSQL) ────────────────────────────────────────────────

variable "db_name" {
  description = "Application database name."
  type        = string
  default     = "finchippay"
}

variable "db_username" {
  description = "Master database username."
  type        = string
  default     = "finchippay_app"
}

variable "db_engine_version" {
  description = "PostgreSQL engine version."
  type        = string
  default     = "16.3"
}

variable "db_instance_class" {
  description = "RDS instance class."
  type        = string
  default     = "db.t3.micro"
}

variable "db_allocated_storage" {
  description = "Allocated database storage in GiB."
  type        = number
  default     = 20
}

variable "db_max_allocated_storage" {
  description = "Maximum storage for autoscaling in GiB (0 disables autoscaling)."
  type        = number
  default     = 50
}

variable "db_multi_az" {
  description = "Deploy a Multi-AZ standby database replica."
  type        = bool
  default     = false
}

variable "db_backup_retention_days" {
  description = "Number of days to retain automated database backups."
  type        = number
  default     = 7
}

variable "db_performance_insights_enabled" {
  description = "Enable RDS Performance Insights."
  type        = bool
  default     = false
}

variable "db_deletion_protection" {
  description = "Protect the database from accidental deletion."
  type        = bool
  default     = false
}

# ─── Cache (ElastiCache Redis) ────────────────────────────────────────────────

variable "redis_engine_version" {
  description = "Redis engine version."
  type        = string
  default     = "7.1"
}

variable "redis_node_type" {
  description = "ElastiCache node type."
  type        = string
  default     = "cache.t3.micro"
}

variable "redis_num_cache_nodes" {
  description = "Number of Redis cache nodes (1 = single node, 2+ = multi-node)."
  type        = number
  default     = 1
}

variable "redis_multi_az" {
  description = "Enable automatic failover for a Multi-AZ Redis deployment (requires >= 2 nodes)."
  type        = bool
  default     = false
}

variable "redis_authentication_enabled" {
  description = "Enable Redis AUTH with a randomly generated token."
  type        = bool
  default     = true
}