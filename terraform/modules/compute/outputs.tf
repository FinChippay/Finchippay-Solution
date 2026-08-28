output "cluster_id" {
  description = "ID of the ECS cluster."
  value       = aws_ecs_cluster.main.id
}

output "cluster_name" {
  description = "Name of the ECS cluster."
  value       = aws_ecs_cluster.main.name
}

output "alb_arn" {
  description = "ARN of the application load balancer."
  value       = aws_lb.main.arn
}

output "alb_dns_name" {
  description = "DNS name of the application load balancer."
  value       = aws_lb.main.dns_name
}

output "alb_zone_id" {
  description = "Canonical hosted zone ID of the load balancer."
  value       = aws_lb.main.zone_id
}

output "backend_service_name" {
  description = "Name of the backend ECS service."
  value       = aws_ecs_service.backend.name
}

output "frontend_service_name" {
  description = "Name of the frontend ECS service."
  value       = aws_ecs_service.frontend.name
}

output "backend_target_group_arn" {
  description = "ARN of the backend target group."
  value       = aws_lb_target_group.backend.arn
}

output "frontend_target_group_arn" {
  description = "ARN of the frontend target group."
  value       = aws_lb_target_group.frontend.arn
}

output "backend_url" {
  description = "Public URL of the backend API."
  value       = local.backend_url
}

output "frontend_url" {
  description = "Public URL of the frontend."
  value       = local.frontend_url
}

output "backend_log_group" {
  description = "Name of the backend CloudWatch log group."
  value       = aws_cloudwatch_log_group.backend.name
}

output "frontend_log_group" {
  description = "Name of the frontend CloudWatch log group."
  value       = aws_cloudwatch_log_group.frontend.name
}