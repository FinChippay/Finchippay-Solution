# terraform/modules/cache/variables.tf

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
  description = "Subnet IDs in which to place the Redis nodes (use private/database subnets)"
  type        = list(string)
}

variable "redis_security_group_id" {
  description = "Security group ID to attach to the Redis cluster"
  type        = string
}

variable "redis_version" {
  description = "Redis engine version"
  type        = string
  default     = "7.0"
}

variable "node_type" {
  description = "ElastiCache node type (e.g. cache.t3.micro, cache.r6g.large)"
  type        = string
  default     = "cache.t3.micro"
}

variable "num_cache_clusters" {
  description = "Number of cache clusters (1 = primary only, 2+ = primary + replicas)"
  type        = number
  default     = 1
  validation {
    condition     = var.num_cache_clusters >= 1 && var.num_cache_clusters <= 6
    error_message = "num_cache_clusters must be between 1 and 6."
  }
}

variable "multi_az" {
  description = "Enable Multi-AZ for the replication group (requires num_cache_clusters >= 2)"
  type        = bool
  default     = false
}

variable "auth_token" {
  description = "Auth token (password) for Redis AUTH (leave empty to disable)"
  type        = string
  default     = ""
  sensitive   = true
}

variable "maxmemory_policy" {
  description = "Redis eviction policy when memory is full"
  type        = string
  default     = "allkeys-lru"
  validation {
    condition = contains([
      "noeviction", "allkeys-lru", "volatile-lru",
      "allkeys-random", "volatile-random", "volatile-ttl",
      "allkeys-lfu", "volatile-lfu"
    ], var.maxmemory_policy)
    error_message = "Invalid maxmemory-policy value."
  }
}

variable "snapshot_retention_days" {
  description = "Number of days to retain Redis snapshots (0 disables snapshots)"
  type        = number
  default     = 1
}

variable "snapshot_window" {
  description = "Daily time range for Redis snapshots (UTC)"
  type        = string
  default     = "02:00-03:00"
}

variable "maintenance_window" {
  description = "Weekly maintenance window for Redis (UTC)"
  type        = string
  default     = "sun:05:00-sun:06:00"
}

variable "enable_slow_log" {
  description = "Stream Redis slow log to CloudWatch Logs"
  type        = bool
  default     = false
}

variable "tags" {
  description = "Additional tags to apply to all resources"
  type        = map(string)
  default     = {}
}
