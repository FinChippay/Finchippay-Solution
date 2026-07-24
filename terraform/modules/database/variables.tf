variable "name_prefix" {
  description = "Prefix applied to every resource name (e.g. finchippay-production)."
  type        = string
}

variable "region" {
  description = "DigitalOcean region slug."
  type        = string
}

variable "engine" {
  description = "Database engine (pg = PostgreSQL, mysql, redis)."
  type        = string
  default     = "pg"
}

variable "engine_version" {
  description = "PostgreSQL major version number."
  type        = string
  default     = "16"
}

variable "node_size" {
  description = "DigitalOcean managed database node size slug."
  type        = string
  default     = "db-s-1vcpu-1gb"
}

variable "node_count" {
  description = "Number of cluster nodes. 1 = standalone, 2+ = HA with standby."
  type        = number
  default     = 1
}

variable "database_name" {
  description = "Name of the application database to create."
  type        = string
  default     = "finchippay"
}

variable "database_user" {
  description = "Username for the application database."
  type        = string
  default     = "finchippay_app"
}

variable "vpc_id" {
  description = "ID of the VPC to place the cluster in."
  type        = string
}

variable "allowed_droplet_ids" {
  description = "List of Droplet IDs that are allowed to connect to the database cluster."
  type        = list(string)
  default     = []
}

variable "tags" {
  description = "List of tag strings to apply to resources."
  type        = list(string)
  default     = []
}
