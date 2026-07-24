# ─── Root module outputs ──────────────────────────────────────────────────────

# ─── Compute ──────────────────────────────────────────────────────────────────

output "droplet_ids" {
  description = "IDs of the provisioned application Droplets."
  value       = module.compute.droplet_ids
}

output "droplet_ipv4_addresses" {
  description = "Public IPv4 addresses of the application Droplets."
  value       = module.compute.droplet_ipv4_addresses
}

output "vpc_id" {
  description = "ID of the private VPC."
  value       = digitalocean_vpc.main.id
}

# ─── Database ─────────────────────────────────────────────────────────────────

output "database_cluster_id" {
  description = "ID of the managed PostgreSQL cluster."
  value       = module.database.cluster_id
}

output "database_host" {
  description = "Hostname of the managed PostgreSQL cluster."
  value       = module.database.host
}

output "database_port" {
  description = "Port of the managed PostgreSQL cluster."
  value       = module.database.port
}

output "database_name" {
  description = "Application database name."
  value       = module.database.database_name
}

output "database_user" {
  description = "Application database username."
  value       = module.database.user
}

output "database_password" {
  description = "Application database password (sensitive)."
  value       = module.database.password
  sensitive   = true
}

output "database_url" {
  description = "Full PostgreSQL connection URL (sensitive)."
  value       = module.database.connection_url
  sensitive   = true
}

output "database_ca_cert" {
  description = "CA certificate for validating TLS connections to the database cluster."
  value       = module.database.ca_cert
  sensitive   = true
}

# ─── Redis ────────────────────────────────────────────────────────────────────

output "redis_cluster_id" {
  description = "ID of the managed Redis cluster."
  value       = module.redis.cluster_id
}

output "redis_host" {
  description = "Hostname of the managed Redis cluster."
  value       = module.redis.host
}

output "redis_port" {
  description = "Port of the managed Redis cluster."
  value       = module.redis.port
}

output "redis_password" {
  description = "Password for the managed Redis cluster (sensitive)."
  value       = module.redis.password
  sensitive   = true
}

output "redis_url" {
  description = "Full Redis connection URL, e.g. rediss://:password@host:port (sensitive)."
  value       = module.redis.connection_url
  sensitive   = true
}
