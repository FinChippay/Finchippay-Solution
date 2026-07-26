# terraform/environments/dev/variables.tf

variable "aws_region" {
  description = "AWS region to deploy into"
  type        = string
  default     = "us-east-1"
}

variable "primary_az" {
  description = "Primary availability zone for single-AZ dev deployment"
  type        = string
  default     = "us-east-1a"
}

variable "domain_name" {
  description = "Apex domain name (e.g. finchippay.com)"
  type        = string
}

variable "create_zone" {
  description = "Whether to create a new Route 53 hosted zone"
  type        = bool
  default     = false
}

variable "existing_zone_id" {
  description = "Existing Route 53 hosted zone ID (when create_zone = false)"
  type        = string
  default     = ""
}
