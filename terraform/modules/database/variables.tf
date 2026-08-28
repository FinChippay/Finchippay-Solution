variable "name_prefix" {
  description = "Prefix applied to every resource name."
  type        = string
}

variable "environment" {
  description = "Deployment environment (dev, staging, prod)."
  type        = string
}

variable "vpc_id" {
  description = "ID of the VPC the database runs in."
  type        = string
}

variable "private_subnet_ids" {
  description = "IDs of the private subnets for the DB subnet group."
  type        = list(string)
}

variable "security_group_id" {
  description = "ID of the security group that allows PostgreSQL access."
  type        = string
}

variable "db_name" {
  description = "Name of the application database."
  type        = string
  default     = "finchippay"
}

variable "db_username" {
  description = "Master username for the database."
  type        = string
  default     = "finchippay_app"
}

variable "engine_version" {
  description = "PostgreSQL engine version."
  type        = string
  default     = "16.3"
}

variable "instance_class" {
  description = "RDS instance class (e.g. db.t3.micro, db.r6g.large)."
  type        = string
  default     = "db.t3.micro"
}

variable "allocated_storage" {
  description = "Allocated storage in GiB."
  type        = number
  default     = 20
}

variable "max_allocated_storage" {
  description = "Maximum storage for autoscaling in GiB (0 disables autoscaling)."
  type        = number
  default     = 50
}

variable "multi_az" {
  description = "Deploy a Multi-AZ standby replica."
  type        = bool
  default     = false
}

variable "backup_retention_days" {
  description = "Number of days to retain automated backups."
  type        = number
  default     = 7
}

variable "storage_encrypted" {
  description = "Encrypt the database storage."
  type        = bool
  default     = true
}

variable "auto_minor_version_upgrade" {
  description = "Apply minor engine upgrades automatically."
  type        = bool
  default     = true
}

variable "performance_insights_enabled" {
  description = "Enable Performance Insights."
  type        = bool
  default     = false
}

variable "deletion_protection" {
  description = "Protect the database from being deleted."
  type        = bool
  default     = false
}

variable "tags" {
  description = "Tags applied to all resources."
  type        = map(string)
  default     = {}
}