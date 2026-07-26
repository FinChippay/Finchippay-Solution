# terraform/modules/dns/main.tf
# Route 53 hosted zone, ACM certificate with DNS validation,
# and A/AAAA alias records pointing to the ALB.

locals {
  name_prefix = "${var.project}-${var.environment}"

  # Subdomain strategy:
  #   prod  → apex domain (finchippay.com) + www
  #   staging → staging.finchippay.com
  #   dev     → dev.finchippay.com
  subdomain = var.environment == "prod" ? "" : "${var.environment}."
  apex_domain = var.domain_name
  full_domain = var.environment == "prod" ? var.domain_name : "${var.environment}.${var.domain_name}"
}

# ── Route 53 Hosted Zone ──────────────────────────────────────────────────────
# If a zone already exists (e.g. managed externally), set create_zone = false
# and provide zone_id directly.

resource "aws_route53_zone" "main" {
  count = var.create_zone ? 1 : 0

  name    = var.domain_name
  comment = "Managed by Terraform — ${local.name_prefix}"

  tags = merge(var.tags, {
    Name = "${local.name_prefix}-hosted-zone"
  })
}

locals {
  zone_id = var.create_zone ? aws_route53_zone.main[0].zone_id : var.existing_zone_id
}

# ── ACM Certificate ───────────────────────────────────────────────────────────

resource "aws_acm_certificate" "main" {
  # ACM certificates used with ALBs must be in us-east-1 only if behind CloudFront;
  # for regional ALBs the certificate must be in the same region as the ALB.
  domain_name               = local.full_domain
  subject_alternative_names = var.environment == "prod" ? ["www.${var.domain_name}", "*.${var.domain_name}"] : ["*.${local.full_domain}"]
  validation_method         = "DNS"

  lifecycle {
    create_before_destroy = true
  }

  tags = merge(var.tags, {
    Name = "${local.name_prefix}-cert"
  })
}

# ── DNS Validation Records ────────────────────────────────────────────────────

resource "aws_route53_record" "cert_validation" {
  for_each = {
    for dvo in aws_acm_certificate.main.domain_validation_options : dvo.domain_name => {
      name   = dvo.resource_record_name
      record = dvo.resource_record_value
      type   = dvo.resource_record_type
    }
  }

  allow_overwrite = true
  name            = each.value.name
  records         = [each.value.record]
  ttl             = 60
  type            = each.value.type
  zone_id         = local.zone_id
}

resource "aws_acm_certificate_validation" "main" {
  certificate_arn         = aws_acm_certificate.main.arn
  validation_record_fqdns = [for record in aws_route53_record.cert_validation : record.fqdn]
}

# ── A Records → ALB ───────────────────────────────────────────────────────────

resource "aws_route53_record" "apex" {
  zone_id = local.zone_id
  name    = local.full_domain
  type    = "A"

  alias {
    name                   = var.alb_dns_name
    zone_id                = var.alb_zone_id
    evaluate_target_health = true
  }
}

resource "aws_route53_record" "www" {
  count = var.environment == "prod" ? 1 : 0

  zone_id = local.zone_id
  name    = "www.${var.domain_name}"
  type    = "A"

  alias {
    name                   = var.alb_dns_name
    zone_id                = var.alb_zone_id
    evaluate_target_health = true
  }
}

# ── Health Check ──────────────────────────────────────────────────────────────

resource "aws_route53_health_check" "api" {
  count = var.create_health_check ? 1 : 0

  fqdn              = local.full_domain
  port              = 443
  type              = "HTTPS"
  resource_path     = "/health"
  failure_threshold = 3
  request_interval  = 30

  tags = merge(var.tags, {
    Name = "${local.name_prefix}-api-health-check"
  })
}
