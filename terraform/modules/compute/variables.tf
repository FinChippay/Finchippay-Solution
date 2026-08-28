variable "name_prefix" {
  description = "Prefix applied to every resource name."
  type        = string
}

variable "environment" {
  description = "Deployment environment (dev, staging, prod)."
  type        = string
}

variable "vpc_id" {
  description = "ID of the VPC the ECS tasks run in."
  type        = string
}

variable "private_subnet_ids" {
  description = "IDs of the private subnets to place ECS tasks in."
  type        = list(string)
}

variable "public_subnet_ids" {
  description = "IDs of the public subnets for the internet-facing load balancer."
  type        = list(string)
}

variable "alb_security_group_id" {
  description = "ID of the ALB security group."
  type        = string
}

variable "app_security_group_id" {
  description = "ID of the application (ECS tasks) security group."
  type        = string
}

# ─── Images ───────────────────────────────────────────────────────────────────

variable "backend_image" {
  description = "Container image URI for the backend API service."
  type        = string
}

variable "frontend_image" {
  description = "Container image URI for the frontend service."
  type        = string
}

# ─── Task sizing ──────────────────────────────────────────────────────────────

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
  description = "Minimum number of backend tasks (autoscaling floor)."
  type        = number
  default     = 1
}

variable "backend_max_capacity" {
  description = "Maximum number of backend tasks (autoscaling ceiling)."
  type        = number
  default     = 4
}

variable "frontend_desired_count" {
  description = "Desired number of frontend tasks."
  type        = number
  default     = 1
}

variable "frontend_min_capacity" {
  description = "Minimum number of frontend tasks."
  type        = number
  default     = 1
}

variable "frontend_max_capacity" {
  description = "Maximum number of frontend tasks."
  type        = number
  default     = 4
}

variable "backend_container_port" {
  description = "Container port the backend listens on."
  type        = number
  default     = 4000
}

variable "frontend_container_port" {
  description = "Container port the frontend listens on."
  type        = number
  default     = 3000
}

variable "enable_autoscaling" {
  description = "Enable application autoscaling on the ECS services."
  type        = bool
  default     = false
}

# ─── DNS / HTTPS ──────────────────────────────────────────────────────────────

variable "create_dns" {
  description = "Create the Route53 A record and terminate TLS with the ACM certificate."
  type        = bool
  default     = false
}

variable "domain_name" {
  description = "Public domain name served by the ALB (used when create_dns is true)."
  type        = string
  default     = ""
}

variable "zone_id" {
  description = "Route53 hosted zone ID for the domain (used when create_dns is true)."
  type        = string
  default     = ""
}

variable "certificate_arn" {
  description = "ARN of the ACM certificate for the domain (used when create_dns is true)."
  type        = string
  default     = ""
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

variable "database_url" {
  description = "PostgreSQL connection URL for the backend (sensitive)."
  type        = string
  sensitive   = true
}

variable "redis_url" {
  description = "Redis connection URL for the backend (sensitive)."
  type        = string
  sensitive   = true
}

variable "jwt_secret" {
  description = "Secret used to sign JWT tokens (sensitive)."
  type        = string
  sensitive   = true
}

variable "tags" {
  description = "Tags applied to all resources."
  type        = map(string)
  default     = {}
}