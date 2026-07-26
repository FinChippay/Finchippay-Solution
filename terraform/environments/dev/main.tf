# terraform/environments/dev/main.tf
# Development environment — single AZ, minimal sizing, cost-optimised.
# Use: terraform -chdir=terraform/environments/dev plan

terraform {
  required_version = ">= 1.6.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  # Uncomment and fill in to use S3 remote state
  # backend "s3" {
  #   bucket         = "finchippay-terraform-state"
  #   key            = "dev/terraform.tfstate"
  #   region         = "us-east-1"
  #   encrypt        = true
  #   dynamodb_table = "finchippay-terraform-locks"
  # }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = "finchippay"
      Environment = "dev"
      ManagedBy   = "terraform"
      Repository  = "FinChippay/Finchippay-Solution"
    }
  }
}

data "aws_caller_identity" "current" {}

# ── Root module ───────────────────────────────────────────────────────────────

module "finchippay" {
  source = "../../"

  project        = "finchippay"
  environment    = "dev"
  aws_region     = var.aws_region
  aws_account_id = data.aws_caller_identity.current.account_id

  # Networking — single AZ, single NAT (cost saving)
  availability_zones    = [var.primary_az]
  vpc_cidr              = "10.10.0.0/16"
  public_subnet_cidrs   = ["10.10.1.0/24"]
  private_subnet_cidrs  = ["10.10.11.0/24"]
  database_subnet_cidrs = ["10.10.21.0/24"]
  single_nat_gateway    = true
  enable_flow_logs      = false

  # Compute — smallest viable sizes
  backend_cpu            = 256
  backend_memory         = 512
  frontend_cpu           = 256
  frontend_memory        = 512
  backend_desired_count  = 1
  frontend_desired_count = 1
  backend_min_count      = 1
  backend_max_count      = 2
  frontend_min_count     = 1
  frontend_max_count     = 2
  log_retention_days     = 7

  # Database — smallest RDS, no multi-AZ, minimal backups
  db_instance_class      = "db.t3.micro"
  db_allocated_storage   = 20
  db_multi_az            = false
  db_backup_retention    = 1
  db_performance_insights = false

  # Cache — smallest node, single replica
  redis_node_type    = "cache.t3.micro"
  redis_num_clusters = 1
  redis_multi_az     = false

  # DNS
  domain_name  = var.domain_name
  create_zone  = var.create_zone
  existing_zone_id = var.existing_zone_id

  # Application
  stellar_network  = "testnet"
  horizon_url      = "https://horizon-testnet.stellar.org"
  allowed_origins  = "https://dev.${var.domain_name}"
  secrets_arn_prefix = "arn:aws:secretsmanager:${var.aws_region}:${data.aws_caller_identity.current.account_id}:secret:dev-finchippay"

  tags = {
    CostCenter = "dev"
  }
}
