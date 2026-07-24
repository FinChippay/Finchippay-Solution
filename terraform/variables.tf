# ─── Authentication ───────────────────────────────────────────────────────────

variable "do_token" {
  description = "DigitalOcean personal access token. Set via TF_VAR_do_token or DIGITALOCEAN_TOKEN environment variable."
  type        = string
  sensitive   = true
}

# ─── Project / naming ─────────────────────────────────────────────────────────

variable "project_name" {
  description = "Slug used to prefix every cloud resource name."
  type        = string
  default     = "finchippay"
}

variable "environment" {
  description = "Deployment environment. Used in resource names and tags. One of: staging, production."
  type        = string
  default     = "production"

  validation {
    condition     = contains(["staging", "production"], var.environment)
    error_message = "environment must be 'staging' or 'production'."
  }
}

variable "region" {
  description = "DigitalOcean region slug for all resources."
  type        = string
  default     = "nyc3"
}

# ─── Compute ──────────────────────────────────────────────────────────────────

variable "droplet_size" {
  description = "DigitalOcean Droplet size slug for the application server."
  type        = string
  default     = "s-2vcpu-4gb"
}

variable "droplet_image" {
  description = "Base OS image slug for the Droplet."
  type        = string
  default     = "docker-20-04"
}

variable "ssh_public_key_path" {
  description = "Path to the SSH public key file that will be authorised on the Droplet."
  type        = string
  default     = "~/.ssh/id_rsa.pub"
}

variable "droplet_count" {
  description = "Number of application Droplets to provision."
  type        = number
  default     = 1
}

# ─── PostgreSQL ───────────────────────────────────────────────────────────────

variable "db_engine" {
  description = "DigitalOcean managed database engine."
  type        = string
  default     = "pg"
}

variable "db_version" {
  description = "PostgreSQL major version."
  type        = string
  default     = "16"
}

variable "db_size" {
  description = "DigitalOcean managed database node size slug."
  type        = string
  default     = "db-s-1vcpu-1gb"
}

variable "db_node_count" {
  description = "Number of nodes in the managed database cluster (1 = standalone, 2+ = HA with standby)."
  type        = number
  default     = 1
}

variable "db_name" {
  description = "Name of the application database to create inside the cluster."
  type        = string
  default     = "finchippay"
}

variable "db_user" {
  description = "Name of the application database user."
  type        = string
  default     = "finchippay_app"
}

# ─── Redis ────────────────────────────────────────────────────────────────────

variable "redis_version" {
  description = "Redis major version."
  type        = string
  default     = "7"
}

variable "redis_size" {
  description = "DigitalOcean managed Redis node size slug."
  type        = string
  default     = "db-s-1vcpu-1gb"
}

variable "redis_node_count" {
  description = "Number of nodes in the Redis cluster."
  type        = number
  default     = 1
}

variable "redis_eviction_policy" {
  description = "Redis eviction policy (e.g. noeviction, allkeys-lru, volatile-lru)."
  type        = string
  default     = "allkeys-lru"
}

# ─── Networking ───────────────────────────────────────────────────────────────

variable "vpc_ip_range" {
  description = "IP range for the private VPC used by all resources."
  type        = string
  default     = "10.10.0.0/16"
}
