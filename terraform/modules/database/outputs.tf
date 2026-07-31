output "cluster_id" {
  description = "ID of the managed PostgreSQL cluster."
  value       = digitalocean_database_cluster.postgres.id
}

output "host" {
  description = "Public hostname of the cluster (use private_host for VPC-internal connections)."
  value       = digitalocean_database_cluster.postgres.host
}

output "private_host" {
  description = "Private hostname of the cluster, reachable from within the VPC."
  value       = digitalocean_database_cluster.postgres.private_host
}

output "port" {
  description = "Port the cluster listens on."
  value       = digitalocean_database_cluster.postgres.port
}

output "database_name" {
  description = "Name of the application database."
  value       = digitalocean_database_db.app_db.name
}

output "user" {
  description = "Application database username."
  value       = digitalocean_database_user.app_user.name
}

output "password" {
  description = "Application database password (sensitive)."
  value       = digitalocean_database_user.app_user.password
  sensitive   = true
}

output "connection_url" {
  description = "Full PostgreSQL connection URL using the private host (sensitive)."
  value = format(
    "postgresql://%s:%s@%s:%d/%s?sslmode=require",
    digitalocean_database_user.app_user.name,
    digitalocean_database_user.app_user.password,
    digitalocean_database_cluster.postgres.private_host,
    digitalocean_database_cluster.postgres.port,
    digitalocean_database_db.app_db.name,
  )
  sensitive = true
}

output "ca_cert" {
  description = "CA certificate for TLS verification of the cluster connection (sensitive)."
  value       = digitalocean_database_cluster.postgres.uri == "" ? "" : digitalocean_database_cluster.postgres.uri
  sensitive   = true
}
