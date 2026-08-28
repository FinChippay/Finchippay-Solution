# ─── Auth token ───────────────────────────────────────────────────────────────

resource "random_password" "auth_token" {
  count   = var.authentication_enabled ? 1 : 0
  length  = 24
  special = false
}

# ─── Subnet group ─────────────────────────────────────────────────────────────

resource "aws_elasticache_subnet_group" "main" {
  name        = "${var.name_prefix}-redis-subnet-group"
  description = "Private subnets for the Finchippay ElastiCache Redis cluster."
  subnet_ids  = var.private_subnet_ids
}

# ─── Parameter group ──────────────────────────────────────────────────────────

resource "aws_elasticache_parameter_group" "main" {
  name        = "${var.name_prefix}-redis-pg"
  family      = "redis7"
  description = "Parameter group for the Finchippay Redis cluster."

  parameter {
    name  = "maxmemory-policy"
    value = "allkeys-lru"
  }

  tags = var.tags
}

# ─── Replication group ────────────────────────────────────────────────────────

resource "aws_elasticache_replication_group" "main" {
  replication_group_id       = "${var.name_prefix}-redis"
  description                = "Finchippay Redis cache"
  engine                     = "redis"
  engine_version             = var.engine_version
  node_type                  = var.node_type
  num_cache_clusters         = var.num_cache_nodes
  parameter_group_name       = aws_elasticache_parameter_group.main.name
  subnet_group_name          = aws_elasticache_subnet_group.main.name
  security_group_ids         = [var.security_group_id]
  automatic_failover_enabled = var.multi_az
  multi_az_enabled           = var.num_cache_nodes > 1 ? var.multi_az : false
  port                       = 6379
  transit_encryption_enabled = true
  at_rest_encryption_enabled = true
  auth_token                 = var.authentication_enabled ? random_password.auth_token[0].result : null
  auto_minor_version_upgrade = true
  snapshot_retention_limit   = 7
  snapshot_window            = "04:00-05:00"
  maintenance_window         = "sun:05:00-sun:06:00"

  tags = var.tags
}