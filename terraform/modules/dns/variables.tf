variable "name_prefix" {
  description = "Prefix applied to every resource name."
  type        = string
}

variable "environment" {
  description = "Deployment environment (dev, staging, prod)."
  type        = string
}

variable "domain_name" {
  description = "Public domain name for the Finchippay deployment."
  type        = string
}

variable "create_zone" {
  description = "Create the Route53 hosted zone (false to reuse an existing zone via zone_id)."
  type        = bool
  default     = true
}

variable "zone_id" {
  description = "ID of an existing Route53 hosted zone (required when create_zone is false)."
  type        = string
  default     = ""
}

variable "tags" {
  description = "Tags applied to all resources."
  type        = map(string)
  default     = {}
}