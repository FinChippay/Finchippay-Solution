# terraform/outputs.tf
# Key outputs surfaced after a successful apply.

# ── URLs ──────────────────────────────────────────────────────────────────────

output "frontend_url" {
  description = "Public HTTPS URL for the Finchippay frontend"
  value       = module.dns.apex_url
}

output "backend_url" {
  description = "Public HTTPS URL for the Finchippay backend API"
  value       = "${module.dns.apex_url}/api"
}

output "alb_dns_name" {
  description = "DNS name of the Application Load Balancer (use for health checks)"
  value       = module.compute.alb_dns_name
}

# ── Database ──────────────────────────────────────────────────────────────────

output "database_endpoint" {
  description = "RDS PostgreSQL connection endpoint (host:port)"
  value       = module.database.db_endpoint
}

output "database_host" {
  description = "RDS PostgreSQL hostname"
  value       = module.database.db_host
}

output "database_port" {
  description = "RDS PostgreSQL port"
  value       = module.database.db_port
}

output "database_name" {
  description = "PostgreSQL database name"
  value       = module.database.db_name
}

output "database_master_secret_arn" {
  description = "ARN of the Secrets Manager secret holding the DB master password"
  value       = module.database.db_master_user_secret_arn
}

# ── Cache ─────────────────────────────────────────────────────────────────────

output "redis_endpoint" {
  description = "ElastiCache Redis primary endpoint address"
  value       = module.cache.redis_primary_endpoint
}

output "redis_connection_string" {
  description = "Redis connection string (redis://<host>:<port>)"
  value       = module.cache.redis_connection_string
}

# ── Networking ────────────────────────────────────────────────────────────────

output "vpc_id" {
  description = "VPC ID"
  value       = module.networking.vpc_id
}

output "nat_gateway_public_ips" {
  description = "Public IPs of the NAT gateways (add to any IP allowlists)"
  value       = module.networking.nat_gateway_public_ips
}

# ── ECR ───────────────────────────────────────────────────────────────────────

output "backend_ecr_repository_url" {
  description = "ECR repository URL for pushing backend Docker images"
  value       = module.compute.backend_ecr_repository_url
}

output "frontend_ecr_repository_url" {
  description = "ECR repository URL for pushing frontend Docker images"
  value       = module.compute.frontend_ecr_repository_url
}

# ── ECS ───────────────────────────────────────────────────────────────────────

output "ecs_cluster_name" {
  description = "ECS cluster name (use for ecs deploy commands)"
  value       = module.compute.ecs_cluster_name
}

output "backend_service_name" {
  description = "ECS backend service name"
  value       = module.compute.backend_service_name
}

output "frontend_service_name" {
  description = "ECS frontend service name"
  value       = module.compute.frontend_service_name
}

# ── DNS ───────────────────────────────────────────────────────────────────────

output "certificate_arn" {
  description = "ARN of the ACM TLS certificate"
  value       = module.dns.certificate_arn
}

output "zone_name_servers" {
  description = "Route 53 name servers (configure at your domain registrar)"
  value       = module.dns.zone_name_servers
}
