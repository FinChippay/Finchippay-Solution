# terraform/modules/dns/outputs.tf

output "zone_id" {
  description = "Route 53 hosted zone ID"
  value       = local.zone_id
}

output "zone_name_servers" {
  description = "Name servers for the hosted zone (configure these at your registrar)"
  value       = var.create_zone ? aws_route53_zone.main[0].name_servers : []
}

output "certificate_arn" {
  description = "ARN of the validated ACM certificate"
  value       = aws_acm_certificate_validation.main.certificate_arn
}

output "full_domain" {
  description = "Full domain name for this environment"
  value       = local.full_domain
}

output "apex_url" {
  description = "HTTPS URL for the apex domain"
  value       = "https://${local.full_domain}"
}

output "health_check_id" {
  description = "ID of the Route 53 health check (if created)"
  value       = try(aws_route53_health_check.api[0].id, null)
}
