# terraform/main.tf
# Root module — wires networking, compute, database, cache, and dns modules
# together for a full Finchippay AWS deployment.
#
# Usage (from repo root):
#   terraform -chdir=terraform/environments/dev    init && plan
#   terraform -chdir=terraform/environments/staging init && plan
#   terraform -chdir=terraform/environments/prod   init && plan

locals {
  name_prefix = "${var.project}-${var.environment}"
  common_tags = merge({
    Project     = var.project
    Environment = var.environment
    ManagedBy   = "terraform"
  }, var.tags)
}

# ── Networking ────────────────────────────────────────────────────────────────

module "networking" {
  source = "./modules/networking"

  project     = var.project
  environment = var.environment

  vpc_cidr              = var.vpc_cidr
  availability_zones    = var.availability_zones
  public_subnet_cidrs   = var.public_subnet_cidrs
  private_subnet_cidrs  = var.private_subnet_cidrs
  database_subnet_cidrs = var.database_subnet_cidrs

  enable_nat_gateway = true
  single_nat_gateway = var.single_nat_gateway
  enable_flow_logs   = var.enable_flow_logs

  backend_port  = 4000
  frontend_port = 80

  tags = local.common_tags
}

# ── DNS + TLS ─────────────────────────────────────────────────────────────────
# DNS must be created before compute so that the ACM certificate ARN is
# available for the ALB HTTPS listener.

module "dns" {
  source = "./modules/dns"

  project     = var.project
  environment = var.environment

  domain_name      = var.domain_name
  create_zone      = var.create_zone
  existing_zone_id = var.existing_zone_id

  # These are placeholders during first-pass plan; replaced after ALB is created.
  # On the first apply, use -target=module.networking,module.dns to get the cert,
  # then run a full apply to create compute resources with the cert ARN.
  alb_dns_name = module.compute.alb_dns_name
  alb_zone_id  = module.compute.alb_zone_id

  create_health_check = var.environment == "prod"

  tags = local.common_tags

  depends_on = [module.compute]
}

# ── Compute (ECS + ALB) ───────────────────────────────────────────────────────

module "compute" {
  source = "./modules/compute"

  project        = var.project
  environment    = var.environment
  aws_region     = var.aws_region
  aws_account_id = var.aws_account_id

  # Networking inputs
  vpc_id                      = module.networking.vpc_id
  public_subnet_ids           = module.networking.public_subnet_ids
  private_subnet_ids          = module.networking.private_subnet_ids
  alb_security_group_id       = module.networking.alb_security_group_id
  ecs_tasks_security_group_id = module.networking.ecs_tasks_security_group_id

  # TLS
  certificate_arn = module.dns.certificate_arn

  # Sizing
  backend_cpu    = var.backend_cpu
  backend_memory = var.backend_memory
  frontend_cpu   = var.frontend_cpu
  frontend_memory = var.frontend_memory

  # Scaling
  backend_desired_count  = var.backend_desired_count
  frontend_desired_count = var.frontend_desired_count
  backend_min_count      = var.backend_min_count
  backend_max_count      = var.backend_max_count
  frontend_min_count     = var.frontend_min_count
  frontend_max_count     = var.frontend_max_count

  # Images
  backend_image_tag  = var.backend_image_tag
  frontend_image_tag = var.frontend_image_tag

  # Application config
  stellar_network    = var.stellar_network
  horizon_url        = var.horizon_url
  allowed_origins    = var.allowed_origins
  backend_api_url    = "https://${var.environment == "prod" ? var.domain_name : "${var.environment}.${var.domain_name}"}/api"
  secrets_arn_prefix = var.secrets_arn_prefix

  # Observability
  enable_container_insights = true
  log_retention_days        = var.log_retention_days

  tags = local.common_tags

  depends_on = [module.networking]
}

# ── Database ──────────────────────────────────────────────────────────────────

module "database" {
  source = "./modules/database"

  project     = var.project
  environment = var.environment

  database_subnet_ids    = module.networking.database_subnet_ids
  rds_security_group_id  = module.networking.rds_security_group_id

  instance_class       = var.db_instance_class
  allocated_storage_gb = var.db_allocated_storage
  multi_az             = var.db_multi_az
  backup_retention_days = var.db_backup_retention

  enable_enhanced_monitoring  = true
  enable_performance_insights = var.db_performance_insights

  tags = local.common_tags

  depends_on = [module.networking]
}

# ── Cache ─────────────────────────────────────────────────────────────────────

module "cache" {
  source = "./modules/cache"

  project     = var.project
  environment = var.environment

  database_subnet_ids     = module.networking.database_subnet_ids
  redis_security_group_id = module.networking.redis_security_group_id

  node_type          = var.redis_node_type
  num_cache_clusters = var.redis_num_clusters
  multi_az           = var.redis_multi_az

  enable_slow_log = var.environment != "prod" # slow log in dev/staging only

  tags = local.common_tags

  depends_on = [module.networking]
}
