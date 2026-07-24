variable "name_prefix" {
  description = "Prefix applied to every resource name (e.g. finchippay-production)."
  type        = string
}

variable "region" {
  description = "DigitalOcean region slug."
  type        = string
}

variable "engine_version" {
  description = "Redis major version number."
  type        = string
  default     = "7"
}

variable "node_size" {
  description = "DigitalOcean managed database node size slug for Redis."
  type        = string
  default     = "db-s-1vcpu-1gb"
}

variable "node_count" {
  description = "Number of Redis cluster nodes. 1 = standalone."
  type        = number
  default     = 1
}

variable "eviction_policy" {
  description = "Redis maxmemory eviction policy (e.g. noeviction, allkeys-lru, volatile-lru)."
  type        = string
  default     = "allkeys-lru"

  validation {
    condition = contains([
      "noeviction", "allkeys-lru", "allkeys-random",
      "volatile-lru", "volatile-random", "volatile-ttl",
    ], var.eviction_policy)
    error_message = "eviction_policy must be one of: noeviction, allkeys-lru, allkeys-random, volatile-lru, volatile-random, volatile-ttl."
  }
}

variable "vpc_id" {
  description = "ID of the VPC to place the Redis cluster in."
  type        = string
}

variable "allowed_droplet_ids" {
  description = "List of Droplet IDs allowed to connect to the Redis cluster."
  type        = list(string)
  default     = []
}

variable "tags" {
  description = "List of tag strings to apply to resources."
  type        = list(string)
  default     = []
}
