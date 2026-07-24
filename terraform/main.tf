# ─── Finchippay — Root Terraform Module ───────────────────────────────────────
#
# Provisions the core DigitalOcean infrastructure for Finchippay:
#   • A private VPC
#   • Compute module  — one or more application Droplets
#   • Database module — DigitalOcean managed PostgreSQL cluster
#   • Redis module    — DigitalOcean managed Redis cluster
#
# Usage:
#   cp terraform.tfvars.example terraform.tfvars
#   # fill in do_token (or export TF_VAR_do_token)
#   terraform init
#   terraform plan
#   terraform apply
# ──────────────────────────────────────────────────────────────────────────────

locals {
  name_prefix = "${var.project_name}-${var.environment}"

  common_tags = [
    "project:${var.project_name}",
    "env:${var.environment}",
  ]
}

# ─── VPC ──────────────────────────────────────────────────────────────────────

resource "digitalocean_vpc" "main" {
  name     = "${local.name_prefix}-vpc"
  region   = var.region
  ip_range = var.vpc_ip_range
}

# ─── Compute ──────────────────────────────────────────────────────────────────

module "compute" {
  source = "./modules/compute"

  name_prefix     = local.name_prefix
  region          = var.region
  droplet_size    = var.droplet_size
  droplet_image   = var.droplet_image
  droplet_count   = var.droplet_count
  vpc_id          = digitalocean_vpc.main.id
  ssh_public_key  = file(var.ssh_public_key_path)
  tags            = local.common_tags
}

# ─── Database ─────────────────────────────────────────────────────────────────

module "database" {
  source = "./modules/database"

  name_prefix    = local.name_prefix
  region         = var.region
  engine         = var.db_engine
  engine_version = var.db_version
  node_size      = var.db_size
  node_count     = var.db_node_count
  database_name  = var.db_name
  database_user  = var.db_user
  vpc_id         = digitalocean_vpc.main.id
  allowed_droplet_ids = module.compute.droplet_ids
  tags           = local.common_tags
}

# ─── Redis ────────────────────────────────────────────────────────────────────

module "redis" {
  source = "./modules/redis"

  name_prefix     = local.name_prefix
  region          = var.region
  engine_version  = var.redis_version
  node_size       = var.redis_size
  node_count      = var.redis_node_count
  eviction_policy = var.redis_eviction_policy
  vpc_id          = digitalocean_vpc.main.id
  allowed_droplet_ids = module.compute.droplet_ids
  tags            = local.common_tags
}
