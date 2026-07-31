output "cluster_id" {
  description = "ID of the managed Redis cluster."
  value       = digitalocean_database_cluster.redis.id
}

output "host" {
  description = "Public hostname of the Redis cluster."
  value       = digitalocean_database_cluster.redis.host
}

output "private_host" {
  description = "Private hostname of the Redis cluster, reachable from within the VPC."
  value       = digitalocean_database_cluster.redis.private_host
}

output "port" {
  description = "Port the Redis cluster listens on."
  value       = digitalocean_database_cluster.redis.port
}

output "password" {
  description = "Redis authentication password (sensitive)."
  value       = digitalocean_database_cluster.redis.password
  sensitive   = true
}

output "connection_url" {
  description = "Full Redis connection URL using the private host (sensitive)."
  value = format(
    "rediss://:%s@%s:%d",
    digitalocean_database_cluster.redis.password,
    digitalocean_database_cluster.redis.private_host,
    digitalocean_database_cluster.redis.port,
  )
  sensitive = true
}
