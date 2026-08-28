output "primary_endpoint_address" {
  description = "Hostname of the primary Redis endpoint."
  value       = aws_elasticache_replication_group.main.primary_endpoint_address
}

output "primary_endpoint_port" {
  description = "Port of the primary Redis endpoint."
  value       = aws_elasticache_replication_group.main.port
}

output "auth_token" {
  description = "Redis AUTH token (sensitive)."
  value       = var.authentication_enabled ? random_password.auth_token[0].result : null
  sensitive   = true
}

output "connection_url" {
  description = "Full Redis connection URL (sensitive)."
  value       = var.authentication_enabled ? "rediss://:${random_password.auth_token[0].result}@${aws_elasticache_replication_group.main.primary_endpoint_address}:${aws_elasticache_replication_group.main.port}" : "redis://${aws_elasticache_replication_group.main.primary_endpoint_address}:${aws_elasticache_replication_group.main.port}"
  sensitive   = true
}

output "replication_group_id" {
  description = "ID of the ElastiCache replication group."
  value       = aws_elasticache_replication_group.main.id
}

output "replication_group_arn" {
  description = "ARN of the ElastiCache replication group."
  value       = aws_elasticache_replication_group.main.arn
}