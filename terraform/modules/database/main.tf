# ─── Credentials ──────────────────────────────────────────────────────────────

resource "random_password" "master" {
  length  = 24
  special = false
}

# ─── Subnet group ─────────────────────────────────────────────────────────────

resource "aws_db_subnet_group" "main" {
  name        = "${var.name_prefix}-db-subnet-group"
  description = "Private subnets for the Finchippay RDS instance."
  subnet_ids  = var.private_subnet_ids

  tags = var.tags
}

# ─── Parameter group ──────────────────────────────────────────────────────────

resource "aws_db_parameter_group" "main" {
  name        = "${var.name_prefix}-pg"
  family      = "postgres16"
  description = "Parameter group for the Finchippay PostgreSQL instance."

  tags = var.tags
}

# ─── RDS instance ─────────────────────────────────────────────────────────────

resource "aws_db_instance" "main" {
  identifier     = "${var.name_prefix}-db"
  engine         = "postgres"
  engine_version = var.engine_version

  instance_class         = var.instance_class
  allocated_storage      = var.allocated_storage
  max_allocated_storage  = var.max_allocated_storage
  storage_encrypted      = var.storage_encrypted
  storage_type           = "gp3"
  multi_az               = var.multi_az
  db_name                = var.db_name
  username               = var.db_username
  password               = random_password.master.result
  port                   = 5432
  parameter_group_name   = aws_db_parameter_group.main.name
  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [var.security_group_id]

  backup_retention_period      = var.backup_retention_days
  backup_window                = "03:00-04:00"
  maintenance_window           = "sun:04:00-sun:05:00"
  auto_minor_version_upgrade   = var.auto_minor_version_upgrade
  performance_insights_enabled = var.performance_insights_enabled
  deletion_protection          = var.deletion_protection
  skip_final_snapshot          = false
  final_snapshot_identifier    = "${var.name_prefix}-db-final-snapshot"

  enabled_cloudwatch_logs_exports = ["postgresql"]

  tags = var.tags
}

# ─── Secrets Manager ──────────────────────────────────────────────────────────

resource "aws_secretsmanager_secret" "database" {
  name        = "${var.name_prefix}-db-credentials"
  description = "Finchippay database credentials."
  tags        = var.tags
}

resource "aws_secretsmanager_secret_version" "database" {
  secret_id = aws_secretsmanager_secret.database.id
  secret_string = jsonencode({
    DATABASE_URL = "postgres://${var.db_username}:${random_password.master.result}@${aws_db_instance.main.address}:${aws_db_instance.main.port}/${var.db_name}?sslmode=require"
    HOST         = aws_db_instance.main.address
    PORT         = tostring(aws_db_instance.main.port)
    DATABASE     = var.db_name
    USERNAME     = var.db_username
    PASSWORD     = random_password.master.result
  })
}