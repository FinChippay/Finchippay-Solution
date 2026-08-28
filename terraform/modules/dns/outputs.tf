output "zone_id" {
  description = "ID of the Route53 hosted zone."
  value       = local.zone_id
}

output "zone_name" {
  description = "Name of the Route53 hosted zone."
  value       = var.create_zone ? aws_route53_zone.main[0].name : var.domain_name
}

output "nameservers" {
  description = "Nameservers of the hosted zone (point the registrar NS records here)."
  value       = var.create_zone ? aws_route53_zone.main[0].name_servers : []
}

output "certificate_arn" {
  description = "ARN of the ACM certificate for the domain."
  value       = aws_acm_certificate.main.arn
}

output "certificate_validation_fqdns" {
  description = "FQDNs used to validate the ACM certificate."
  value       = aws_acm_certificate_validation.main.validation_record_fqdns
}