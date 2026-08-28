# ─── Finchippay — Root Terraform Module (AWS) ────────────────────────────────
#
# Provisions the AWS infrastructure for Finchippay:
#   • networking — VPC, public/private subnets, NAT gateway, security groups
#   • compute    — ECS Fargate cluster, tasks, services, ALB, autoscaling
#   • database   — RDS PostgreSQL instance (subnet group, parameter group)
#   • cache      — ElastiCache Redis cluster (subnet group, parameter group)
#   • dns        — Route53 hosted zone + ACM certificate (when create_dns)
#
# Usage (from terraform/):
#   terraform init
#   terraform plan   -var-file="environments/dev/dev.tfvars"
#   terraform apply  -var-file="environments/dev/dev.tfvars"
# ──────────────────────────────────────────────────────────────────────────────

locals {
  name_prefix = "${var.project_name}-${var.environment}"

  tags = merge(var.tags, {
    Project     = var.project_name
    Environment = var.environment
    ManagedBy   = "terraform"
  })
}

# ─── Application JWT secret (stable in state) ─────────────────────────────────

resource "random_password" "jwt_secret" {
  length  = 48
  special = false
}

# ─── DNS / certificate (optional) ─────────────────────────────────────────────

module "dns" {
  source = "./modules/dns"
  count  = var.create_dns ? 1 : 0

  name_prefix = local.name_prefix
  environment = var.environment
  domain_name = var.domain_name
  create_zone = var.create_hosted_zone
  zone_id     = var.hosted_zone_id
  tags        = local.tags
}

# ─── Networking ───────────────────────────────────────────────────────────────

module "networking" {
  source = "./modules/networking"

  name_prefix          = local.name_prefix
  environment          = var.environment
  vpc_cidr             = var.vpc_cidr
  availability_zones   = var.availability_zones
  public_subnet_cidrs  = var.public_subnet_cidrs
  private_subnet_cidrs = var.private_subnet_cidrs
  tags                 = local.tags
}

# ─── Database ─────────────────────────────────────────────────────────────────

module "database" {
  source = "./modules/database"

  name_prefix                  = local.name_prefix
  environment                  = var.environment
  vpc_id                       = module.networking.vpc_id
  private_subnet_ids           = module.networking.private_subnet_ids
  security_group_id            = module.networking.database_security_group_id
  db_name                      = var.db_name
  db_username                  = var.db_username
  engine_version               = var.db_engine_version
  instance_class               = var.db_instance_class
  allocated_storage            = var.db_allocated_storage
  max_allocated_storage        = var.db_max_allocated_storage
  multi_az                     = var.db_multi_az
  backup_retention_days        = var.db_backup_retention_days
  performance_insights_enabled = var.db_performance_insights_enabled
  deletion_protection          = var.db_deletion_protection
  tags                         = local.tags
}

# ─── Cache ────────────────────────────────────────────────────────────────────

module "cache" {
  source = "./modules/cache"

  name_prefix            = local.name_prefix
  environment            = var.environment
  vpc_id                 = module.networking.vpc_id
  private_subnet_ids     = module.networking.private_subnet_ids
  security_group_id      = module.networking.redis_security_group_id
  engine_version         = var.redis_engine_version
  node_type              = var.redis_node_type
  num_cache_nodes        = var.redis_num_cache_nodes
  multi_az               = var.redis_multi_az
  authentication_enabled = var.redis_authentication_enabled
  tags                   = local.tags
}

# ─── Compute ──────────────────────────────────────────────────────────────────

module "compute" {
  source = "./modules/compute"

  name_prefix           = local.name_prefix
  environment           = var.environment
  vpc_id                = module.networking.vpc_id
  public_subnet_ids     = module.networking.public_subnet_ids
  private_subnet_ids    = module.networking.private_subnet_ids
  alb_security_group_id = module.networking.alb_security_group_id
  app_security_group_id = module.networking.app_security_group_id

  backend_image          = var.backend_image
  frontend_image         = var.frontend_image
  backend_cpu            = var.backend_cpu
  backend_memory         = var.backend_memory
  frontend_cpu           = var.frontend_cpu
  frontend_memory        = var.frontend_memory
  backend_desired_count  = var.backend_desired_count
  backend_min_capacity   = var.backend_min_capacity
  backend_max_capacity   = var.backend_max_capacity
  frontend_desired_count = var.frontend_desired_count
  frontend_min_capacity  = var.frontend_min_capacity
  frontend_max_capacity  = var.frontend_max_capacity
  enable_autoscaling     = var.enable_autoscaling

  create_dns      = var.create_dns
  domain_name     = var.domain_name
  zone_id         = var.create_dns ? module.dns[0].zone_id : ""
  certificate_arn = var.create_dns ? module.dns[0].certificate_arn : ""

  allowed_origins                = var.allowed_origins
  stellar_network                = var.stellar_network
  horizon_url                    = var.horizon_url
  turrets_evaluation_interval_ms = var.turrets_evaluation_interval_ms

  database_url = module.database.connection_url
  redis_url    = module.cache.connection_url
  jwt_secret   = random_password.jwt_secret.result
  tags         = local.tags
}