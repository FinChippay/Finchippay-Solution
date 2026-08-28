output "endpoint" {
  description = "Hostname of the RDS instance."
  value       = aws_db_instance.main.address
}

output "port" {
  description = "Port of the RDS instance."
  value       = aws_db_instance.main.port
}

output "db_name" {
  description = "Application database name."
  value       = aws_db_instance.main.db_name
}

output "username" {
  description = "Master database username."
  value       = aws_db_instance.main.username
}

output "password" {
  description = "Master database password (sensitive)."
  value       = random_password.master.result
  sensitive   = true
}

output "connection_url" {
  description = "Full PostgreSQL connection URL (sensitive)."
  value       = "postgres://${aws_db_instance.main.username}:${random_password.master.result}@${aws_db_instance.main.address}:${aws_db_instance.main.port}/${aws_db_instance.main.db_name}?sslmode=require"
  sensitive   = true
}

output "secret_arn" {
  description = "ARN of the Secrets Manager secret holding the database credentials."
  value       = aws_secretsmanager_secret.database.arn
}

output "db_instance_id" {
  description = "Identifier of the RDS instance."
  value       = aws_db_instance.main.id
}