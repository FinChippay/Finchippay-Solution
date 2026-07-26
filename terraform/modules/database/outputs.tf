# terraform/modules/database/outputs.tf

output "db_instance_id" {
  description = "ID of the RDS instance"
  value       = aws_db_instance.main.id
}

output "db_instance_arn" {
  description = "ARN of the RDS instance"
  value       = aws_db_instance.main.arn
}

output "db_endpoint" {
  description = "Connection endpoint of the RDS instance"
  value       = aws_db_instance.main.endpoint
}

output "db_host" {
  description = "Hostname of the RDS instance (without port)"
  value       = aws_db_instance.main.address
}

output "db_port" {
  description = "Port of the RDS instance"
  value       = aws_db_instance.main.port
}

output "db_name" {
  description = "Name of the initial database"
  value       = aws_db_instance.main.db_name
}

output "db_username" {
  description = "Master DB username"
  value       = aws_db_instance.main.username
  sensitive   = true
}

output "db_master_user_secret_arn" {
  description = "ARN of the Secrets Manager secret containing the master password (when use_secrets_manager_password = true)"
  value       = try(aws_db_instance.main.master_user_secret[0].secret_arn, null)
}

output "db_subnet_group_name" {
  description = "Name of the DB subnet group"
  value       = aws_db_subnet_group.main.name
}

output "db_parameter_group_name" {
  description = "Name of the DB parameter group"
  value       = aws_db_parameter_group.main.name
}
