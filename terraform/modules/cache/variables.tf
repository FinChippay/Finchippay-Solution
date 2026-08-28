variable "name_prefix" {
  description = "Prefix applied to every resource name."
  type        = string
}

variable "environment" {
  description = "Deployment environment (dev, staging, prod)."
  type        = string
}

variable "vpc_id" {
  description = "ID of the VPC the Redis cluster runs in."
  type        = string
}

variable "private_subnet_ids" {
  description = "IDs of the private subnets for the ElastiCache subnet group."
  type        = list(string)
}

variable "security_group_id" {
  description = "ID of the security group that allows Redis access."
  type        = string
}

variable "engine_version" {
  description = "Redis engine version."
  type        = string
  default     = "7.1"
}

variable "node_type" {
  description = "ElastiCache node type (e.g. cache.t3.micro, cache.r6g.large)."
  type        = string
  default     = "cache.t3.micro"
}

variable "num_cache_nodes" {
  description = "Number of cache nodes (1 = single node, 2+ = multi-node)."
  type        = number
  default     = 1
}

variable "multi_az" {
  description = "Enable automatic failover for a Multi-AZ deployment (requires >= 2 nodes)."
  type        = bool
  default     = false
}

variable "authentication_enabled" {
  description = "Enable Redis AUTH with a randomly generated token."
  type        = bool
  default     = true
}

variable "tags" {
  description = "Tags applied to all resources."
  type        = map(string)
  default     = {}
}