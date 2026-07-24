variable "name_prefix" {
  description = "Prefix applied to every resource name (e.g. finchippay-production)."
  type        = string
}

variable "region" {
  description = "DigitalOcean region slug for the Droplets."
  type        = string
}

variable "droplet_size" {
  description = "DigitalOcean Droplet size slug (e.g. s-2vcpu-4gb)."
  type        = string
  default     = "s-2vcpu-4gb"
}

variable "droplet_image" {
  description = "Droplet base image slug. 'docker-20-04' is the DO Marketplace Docker image on Ubuntu 20.04."
  type        = string
  default     = "docker-20-04"
}

variable "droplet_count" {
  description = "Number of application Droplets to create."
  type        = number
  default     = 1

  validation {
    condition     = var.droplet_count >= 1
    error_message = "droplet_count must be at least 1."
  }
}

variable "vpc_id" {
  description = "ID of the VPC to place the Droplets in."
  type        = string
}

variable "ssh_public_key" {
  description = "Content of the SSH public key to install on the Droplet(s)."
  type        = string
  sensitive   = true
}

variable "tags" {
  description = "List of tag strings to apply to resources."
  type        = list(string)
  default     = []
}
