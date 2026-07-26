# terraform/modules/database/main.tf
# RDS PostgreSQL instance with subnet group, parameter group,
# automated backups, encryption at rest, and deletion protection.

locals {
  name_prefix = "${var.project}-${var.environment}"
}

# ── DB Subnet Group ───────────────────────────────────────────────────────────

resource "aws_db_subnet_group" "main" {
  name        = "${local.name_prefix}-db-subnet-group"
  description = "Subnet group for ${local.name_prefix} RDS instance"
  subnet_ids  = var.database_subnet_ids

  tags = merge(var.tags, {
    Name = "${local.name_prefix}-db-subnet-group"
  })
}

# ── DB Parameter Group ────────────────────────────────────────────────────────

resource "aws_db_parameter_group" "main" {
  name        = "${local.name_prefix}-pg15"
  family      = "postgres15"
  description = "Custom parameters for ${local.name_prefix} PostgreSQL 15"

  # Performance settings
  parameter {
    name  = "log_connections"
    value = "1"
  }

  parameter {
    name  = "log_disconnections"
    value = "1"
  }

  parameter {
    name  = "log_duration"
    value = "0"
  }

  parameter {
    name  = "log_min_duration_statement"
    value = var.environment == "prod" ? "1000" : "500" # ms; log slow queries
  }

  parameter {
    name  = "log_statement"
    value = var.environment == "prod" ? "none" : "ddl" # DDL in non-prod
  }

  parameter {
    name  = "shared_preload_libraries"
    value = "pg_stat_statements"
  }

  parameter {
    name  = "track_activity_query_size"
    value = "4096"
  }

  parameter {
    name  = "pg_stat_statements.track"
    value = "ALL"
  }

  parameter {
    name         = "max_connections"
    value        = tostring(var.max_connections)
    apply_method = "pending-reboot"
  }

  parameter {
    name  = "rds.force_ssl"
    value = "1"
  }

  tags = merge(var.tags, {
    Name = "${local.name_prefix}-pg15-params"
  })

  lifecycle {
    create_before_destroy = true
  }
}

# ── RDS Instance ──────────────────────────────────────────────────────────────

resource "aws_db_instance" "main" {
  identifier = "${local.name_prefix}-postgres"

  # Engine
  engine               = "postgres"
  engine_version       = var.postgres_version
  instance_class       = var.instance_class
  parameter_group_name = aws_db_parameter_group.main.name

  # Storage
  allocated_storage     = var.allocated_storage_gb
  max_allocated_storage = var.max_allocated_storage_gb
  storage_type          = "gp3"
  storage_encrypted     = true
  kms_key_id            = var.kms_key_arn != "" ? var.kms_key_arn : null

  # Credentials
  db_name  = var.db_name
  username = var.db_username
  # Password is managed via Secrets Manager after first apply; not stored in state
  manage_master_user_password = var.use_secrets_manager_password

  # Network
  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [var.rds_security_group_id]
  publicly_accessible    = false
  port                   = 5432

  # High availability
  multi_az = var.multi_az

  # Backups
  backup_retention_period   = var.backup_retention_days
  backup_window             = var.backup_window
  maintenance_window        = var.maintenance_window
  copy_tags_to_snapshot     = true
  skip_final_snapshot       = var.environment != "prod"
  final_snapshot_identifier = var.environment == "prod" ? "${local.name_prefix}-final-snapshot-${formatdate("YYYYMMDD", timestamp())}" : null
  delete_automated_backups  = var.environment != "prod"

  # Protection
  deletion_protection = var.environment == "prod"

  # Monitoring
  monitoring_interval             = var.enable_enhanced_monitoring ? 60 : 0
  monitoring_role_arn             = var.enable_enhanced_monitoring ? aws_iam_role.rds_enhanced_monitoring[0].arn : null
  performance_insights_enabled    = var.enable_performance_insights
  performance_insights_retention_period = var.enable_performance_insights ? 7 : null
  enabled_cloudwatch_logs_exports = ["postgresql", "upgrade"]

  # Upgrade
  auto_minor_version_upgrade = true
  allow_major_version_upgrade = false

  apply_immediately = var.environment != "prod"

  tags = merge(var.tags, {
    Name = "${local.name_prefix}-postgres"
  })

  lifecycle {
    # Prevent accidental destruction of the database
    prevent_destroy = false # flip to true in prod overlay
    ignore_changes = [
      # Ignore password changes after creation (managed externally)
      password,
      final_snapshot_identifier
    ]
  }
}

# ── Enhanced Monitoring Role ──────────────────────────────────────────────────

resource "aws_iam_role" "rds_enhanced_monitoring" {
  count = var.enable_enhanced_monitoring ? 1 : 0

  name = "${local.name_prefix}-rds-monitoring-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "monitoring.rds.amazonaws.com" }
    }]
  })

  tags = var.tags
}

resource "aws_iam_role_policy_attachment" "rds_enhanced_monitoring" {
  count = var.enable_enhanced_monitoring ? 1 : 0

  role       = aws_iam_role.rds_enhanced_monitoring[0].name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonRDSEnhancedMonitoringRole"
}

# ── CloudWatch Alarms ─────────────────────────────────────────────────────────

resource "aws_cloudwatch_metric_alarm" "db_cpu_high" {
  alarm_name          = "${local.name_prefix}-rds-cpu-high"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "CPUUtilization"
  namespace           = "AWS/RDS"
  period              = 300
  statistic           = "Average"
  threshold           = 80
  alarm_description   = "RDS CPU utilization is over 80%"

  dimensions = {
    DBInstanceIdentifier = aws_db_instance.main.id
  }

  tags = var.tags
}

resource "aws_cloudwatch_metric_alarm" "db_connections_high" {
  alarm_name          = "${local.name_prefix}-rds-connections-high"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "DatabaseConnections"
  namespace           = "AWS/RDS"
  period              = 300
  statistic           = "Average"
  threshold           = var.max_connections * 0.8
  alarm_description   = "RDS connection count is over 80% of max"

  dimensions = {
    DBInstanceIdentifier = aws_db_instance.main.id
  }

  tags = var.tags
}

resource "aws_cloudwatch_metric_alarm" "db_storage_low" {
  alarm_name          = "${local.name_prefix}-rds-storage-low"
  comparison_operator = "LessThanThreshold"
  evaluation_periods  = 2
  metric_name         = "FreeStorageSpace"
  namespace           = "AWS/RDS"
  period              = 300
  statistic           = "Average"
  # Alert at 20% of initial allocation remaining
  threshold     = var.allocated_storage_gb * 1073741824 * 0.2 # bytes
  alarm_description = "RDS free storage space is below 20% of initial allocation"

  dimensions = {
    DBInstanceIdentifier = aws_db_instance.main.id
  }

  tags = var.tags
}
