# terraform/modules/cache/main.tf
# ElastiCache Redis replication group, subnet group, and parameter group.
# Used for API response caching, rate-limit counters, and session storage.

locals {
  name_prefix = "${var.project}-${var.environment}"
}

# ── ElastiCache Subnet Group ──────────────────────────────────────────────────

resource "aws_elasticache_subnet_group" "main" {
  name        = "${local.name_prefix}-redis-subnet-group"
  description = "Subnet group for ${local.name_prefix} Redis cluster"
  subnet_ids  = var.database_subnet_ids

  tags = merge(var.tags, {
    Name = "${local.name_prefix}-redis-subnet-group"
  })
}

# ── ElastiCache Parameter Group ───────────────────────────────────────────────

resource "aws_elasticache_parameter_group" "main" {
  name        = "${local.name_prefix}-redis7"
  family      = "redis7"
  description = "Custom parameters for ${local.name_prefix} Redis 7"

  parameter {
    name  = "maxmemory-policy"
    value = var.maxmemory_policy
  }

  parameter {
    name  = "notify-keyspace-events"
    value = ""
  }

  parameter {
    name  = "timeout"
    value = "300" # disconnect idle clients after 5 minutes
  }

  parameter {
    name  = "tcp-keepalive"
    value = "300"
  }

  tags = merge(var.tags, {
    Name = "${local.name_prefix}-redis7-params"
  })

  lifecycle {
    create_before_destroy = true
  }
}

# ── ElastiCache Replication Group ─────────────────────────────────────────────

resource "aws_elasticache_replication_group" "main" {
  replication_group_id = "${local.name_prefix}-redis"
  description          = "Redis cluster for ${local.name_prefix}"

  # Engine
  engine               = "redis"
  engine_version       = var.redis_version
  node_type            = var.node_type
  parameter_group_name = aws_elasticache_parameter_group.main.name
  port                 = 6379

  # Network
  subnet_group_name  = aws_elasticache_subnet_group.main.name
  security_group_ids = [var.redis_security_group_id]

  # Replication: num_cache_clusters > 1 enables a primary + replica(s)
  num_cache_clusters         = var.num_cache_clusters
  automatic_failover_enabled = var.num_cache_clusters > 1 ? true : false
  multi_az_enabled           = var.multi_az && var.num_cache_clusters > 1

  # Encryption
  at_rest_encryption_enabled  = true
  transit_encryption_enabled  = true
  auth_token                  = var.auth_token != "" ? var.auth_token : null
  auth_token_update_strategy  = var.auth_token != "" ? "ROTATE" : null

  # Backups
  snapshot_retention_limit = var.snapshot_retention_days
  snapshot_window          = var.snapshot_window
  maintenance_window       = var.maintenance_window

  # Upgrades
  auto_minor_version_upgrade = true
  apply_immediately          = var.environment != "prod"

  # Logging
  dynamic "log_delivery_configuration" {
    for_each = var.enable_slow_log ? [1] : []
    content {
      destination      = aws_cloudwatch_log_group.redis_slow_log[0].name
      destination_type = "cloudwatch-logs"
      log_format       = "json"
      log_type         = "slow-log"
    }
  }

  tags = merge(var.tags, {
    Name = "${local.name_prefix}-redis"
  })
}

# ── CloudWatch Log Group for Slow Log ─────────────────────────────────────────

resource "aws_cloudwatch_log_group" "redis_slow_log" {
  count = var.enable_slow_log ? 1 : 0

  name              = "/aws/elasticache/${local.name_prefix}/redis/slow-log"
  retention_in_days = 30

  tags = var.tags
}

# ── CloudWatch Alarms ─────────────────────────────────────────────────────────

resource "aws_cloudwatch_metric_alarm" "redis_cpu_high" {
  alarm_name          = "${local.name_prefix}-redis-cpu-high"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "EngineCPUUtilization"
  namespace           = "AWS/ElastiCache"
  period              = 300
  statistic           = "Average"
  threshold           = 80
  alarm_description   = "Redis CPU utilization is over 80%"

  dimensions = {
    ReplicationGroupId = aws_elasticache_replication_group.main.id
  }

  tags = var.tags
}

resource "aws_cloudwatch_metric_alarm" "redis_memory_high" {
  alarm_name          = "${local.name_prefix}-redis-memory-high"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "DatabaseMemoryUsagePercentage"
  namespace           = "AWS/ElastiCache"
  period              = 300
  statistic           = "Average"
  threshold           = 85
  alarm_description   = "Redis memory usage is over 85%"

  dimensions = {
    ReplicationGroupId = aws_elasticache_replication_group.main.id
  }

  tags = var.tags
}

resource "aws_cloudwatch_metric_alarm" "redis_evictions" {
  alarm_name          = "${local.name_prefix}-redis-evictions"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "Evictions"
  namespace           = "AWS/ElastiCache"
  period              = 300
  statistic           = "Sum"
  threshold           = 100
  alarm_description   = "Redis evictions are high — consider increasing node_type"
  treat_missing_data  = "notBreaching"

  dimensions = {
    ReplicationGroupId = aws_elasticache_replication_group.main.id
  }

  tags = var.tags
}
