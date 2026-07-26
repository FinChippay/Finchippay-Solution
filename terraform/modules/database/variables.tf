# terraform/modules/database/variables.tf

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

variable "database_subnet_ids" {
  description = "IDs of the database subnets"
  type        = list(string)
}

variable "rds_security_group_id" {
  description = "Security group ID to attach to the RDS instance"
  type        = string
}

variable "postgres_version" {
  description = "PostgreSQL engine version"
  type        = string
  default     = "15.4"
}

variable "instance_class" {
  description = "RDS instance class (e.g. db.t3.micro, db.t3.medium, db.r6g.large)"
  type        = string
  default     = "db.t3.micro"
}

variable "allocated_storage_gb" {
  description = "Initial storage allocation in GB"
  type        = number
  default     = 20
}

variable "max_allocated_storage_gb" {
  description = "Maximum storage auto-scaling limit in GB"
  type        = number
  default     = 100
}

variable "db_name" {
  description = "Name of the initial database"
  type        = string
  default     = "finchippay"
}

variable "db_username" {
  description = "Master DB username"
  type        = string
  default     = "finchippay_admin"
}

variable "use_secrets_manager_password" {
  description = "Let RDS manage the master password in Secrets Manager"
  type        = bool
  default     = true
}

variable "kms_key_arn" {
  description = "ARN of the KMS key for storage encryption (empty = AWS-managed key)"
  type        = string
  default     = ""
}

variable "multi_az" {
  description = "Enable Multi-AZ deployment for high availability"
  type        = bool
  default     = false
}

variable "backup_retention_days" {
  description = "Number of days to retain automated backups (0 disables backups)"
  type        = number
  default     = 7
}

variable "backup_window" {
  description = "Daily time range for automated backups (UTC)"
  type        = string
  default     = "03:00-04:00"
}

variable "maintenance_window" {
  description = "Weekly time range for maintenance (UTC)"
  type        = string
  default     = "sun:04:00-sun:05:00"
}

variable "max_connections" {
  description = "max_connections parameter for PostgreSQL"
  type        = number
  default     = 100
}

variable "enable_enhanced_monitoring" {
  description = "Enable RDS Enhanced Monitoring (1-minute granularity)"
  type        = bool
  default     = true
}

variable "enable_performance_insights" {
  description = "Enable RDS Performance Insights"
  type        = bool
  default     = false
}

variable "tags" {
  description = "Additional tags to apply to all resources"
  type        = map(string)
  default     = {}
}
