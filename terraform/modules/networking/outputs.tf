output "vpc_id" {
  description = "ID of the VPC."
  value       = aws_vpc.main.id
}

output "vpc_cidr_block" {
  description = "CIDR block of the VPC."
  value       = aws_vpc.main.cidr_block
}

output "public_subnet_ids" {
  description = "IDs of the public subnets."
  value       = aws_subnet.public[*].id
}

output "private_subnet_ids" {
  description = "IDs of the private subnets."
  value       = aws_subnet.private[*].id
}

output "alb_security_group_id" {
  description = "ID of the ALB security group."
  value       = aws_security_group.alb.id
}

output "app_security_group_id" {
  description = "ID of the application (ECS tasks) security group."
  value       = aws_security_group.app.id
}

output "database_security_group_id" {
  description = "ID of the RDS security group."
  value       = aws_security_group.database.id
}

output "redis_security_group_id" {
  description = "ID of the ElastiCache Redis security group."
  value       = aws_security_group.redis.id
}