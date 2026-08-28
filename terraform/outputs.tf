# ─── Networking ───────────────────────────────────────────────────────────────

output "vpc_id" {
  description = "ID of the VPC."
  value       = module.networking.vpc_id
}

output "vpc_cidr_block" {
  description = "CIDR block of the VPC."
  value       = module.networking.vpc_cidr_block
}

output "public_subnet_ids" {
  description = "IDs of the public subnets."
  value       = module.networking.public_subnet_ids
}

output "private_subnet_ids" {
  description = "IDs of the private subnets."
  value       = module.networking.private_subnet_ids
}

# ─── Compute ──────────────────────────────────────────────────────────────────

output "cluster_id" {
  description = "ID of the ECS cluster."
  value       = module.compute.cluster_id
}

output "cluster_name" {
  description = "Name of the ECS cluster."
  value       = module.compute.cluster_name
}

output "alb_dns_name" {
  description = "DNS name of the application load balancer."
  value       = module.compute.alb_dns_name
}

output "backend_url" {
  description = "Public URL of the backend API."
  value       = module.compute.backend_url
}

output "frontend_url" {
  description = "Public URL of the frontend."
  value       = module.compute.frontend_url
}

output "backend_log_group" {
  description = "Name of the backend CloudWatch log group."
  value       = module.compute.backend_log_group
}

output "frontend_log_group" {
  description = "Name of the frontend CloudWatch log group."
  value       = module.compute.frontend_log_group
}

# ─── Database ─────────────────────────────────────────────────────────────────

output "database_endpoint" {
  description = "Hostname:port of the RDS PostgreSQL instance."
  value       = "${module.database.endpoint}:${module.database.port}"
}

output "database_host" {
  description = "Hostname of the RDS PostgreSQL instance."
  value       = module.database.endpoint
}

output "database_port" {
  description = "Port of the RDS PostgreSQL instance."
  value       = module.database.port
}

output "database_name" {
  description = "Application database name."
  value       = module.database.db_name
}

output "database_username" {
  description = "Master database username."
  value       = module.database.username
}

output "database_password" {
  description = "Master database password (sensitive)."
  value       = module.database.password
  sensitive   = true
}

output "database_connection_url" {
  description = "Full PostgreSQL connection URL (sensitive)."
  value       = module.database.connection_url
  sensitive   = true
}

output "database_secret_arn" {
  description = "ARN of the Secrets Manager secret holding the database credentials."
  value       = module.database.secret_arn
}

# ─── Cache ────────────────────────────────────────────────────────────────────

output "redis_endpoint" {
  description = "Hostname:port of the primary ElastiCache Redis endpoint."
  value       = "${module.cache.primary_endpoint_address}:${module.cache.primary_endpoint_port}"
}

output "redis_host" {
  description = "Hostname of the primary ElastiCache Redis endpoint."
  value       = module.cache.primary_endpoint_address
}

output "redis_port" {
  description = "Port of the primary ElastiCache Redis endpoint."
  value       = module.cache.primary_endpoint_port
}

output "redis_auth_token" {
  description = "Redis AUTH token (sensitive)."
  value       = module.cache.auth_token
  sensitive   = true
}

output "redis_connection_url" {
  description = "Full Redis connection URL (sensitive)."
  value       = module.cache.connection_url
  sensitive   = true
}

# ─── DNS ──────────────────────────────────────────────────────────────────────

output "hosted_zone_id" {
  description = "ID of the Route53 hosted zone."
  value       = var.create_dns ? module.dns[0].zone_id : ""
}

output "hosted_zone_nameservers" {
  description = "Nameservers of the Route53 hosted zone."
  value       = var.create_dns ? module.dns[0].nameservers : []
}

output "acm_certificate_arn" {
  description = "ARN of the ACM certificate for the domain."
  value       = var.create_dns ? module.dns[0].certificate_arn : ""
}