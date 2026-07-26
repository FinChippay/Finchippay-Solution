# terraform/modules/dns/variables.tf

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

variable "domain_name" {
  description = "Apex domain name (e.g. finchippay.com)"
  type        = string
}

variable "create_zone" {
  description = "Whether to create a new Route 53 hosted zone (false = use existing_zone_id)"
  type        = bool
  default     = true
}

variable "existing_zone_id" {
  description = "ID of an existing Route 53 hosted zone (used when create_zone = false)"
  type        = string
  default     = ""
}

variable "alb_dns_name" {
  description = "DNS name of the Application Load Balancer"
  type        = string
}

variable "alb_zone_id" {
  description = "Route 53 canonical hosted zone ID of the ALB"
  type        = string
}

variable "create_health_check" {
  description = "Create a Route 53 health check for the API endpoint"
  type        = bool
  default     = true
}

variable "tags" {
  description = "Additional tags to apply to all resources"
  type        = map(string)
  default     = {}
}
