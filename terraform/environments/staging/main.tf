# terraform/environments/staging/main.tf
# Staging environment — multi-AZ, medium sizing, mirrors prod topology at reduced cost.
# Use: terraform -chdir=terraform/environments/staging plan

terraform {
  required_version = ">= 1.6.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  # backend "s3" {
  #   bucket         = "finchippay-terraform-state"
  #   key            = "staging/terraform.tfstate"
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
      Environment = "staging"
      ManagedBy   = "terraform"
      Repository  = "FinChippay/Finchippay-Solution"
    }
  }
}

data "aws_caller_identity" "current" {}

module "finchippay" {
  source = "../../"

  project        = "finchippay"
  environment    = "staging"
  aws_region     = var.aws_region
  aws_account_id = data.aws_caller_identity.current.account_id

  # Networking — two AZs, one NAT per AZ
  availability_zones    = var.availability_zones
  vpc_cidr              = "10.20.0.0/16"
  public_subnet_cidrs   = ["10.20.1.0/24", "10.20.2.0/24"]
  private_subnet_cidrs  = ["10.20.11.0/24", "10.20.12.0/24"]
  database_subnet_cidrs = ["10.20.21.0/24", "10.20.22.0/24"]
  single_nat_gateway    = true # save cost in staging
  enable_flow_logs      = true

  # Compute — medium sizing
  backend_cpu            = 512
  backend_memory         = 1024
  frontend_cpu           = 256
  frontend_memory        = 512
  backend_desired_count  = 2
  frontend_desired_count = 2
  backend_min_count      = 1
  backend_max_count      = 4
  frontend_min_count     = 1
  frontend_max_count     = 4
  log_retention_days     = 14

  # Database — medium, multi-AZ for staging
  db_instance_class      = "db.t3.medium"
  db_allocated_storage   = 50
  db_multi_az            = true
  db_backup_retention    = 7
  db_performance_insights = true

  # Cache — small node, single replica
  redis_node_type    = "cache.t3.small"
  redis_num_clusters = 2
  redis_multi_az     = false

  # DNS
  domain_name      = var.domain_name
  create_zone      = var.create_zone
  existing_zone_id = var.existing_zone_id

  # Application
  stellar_network  = "testnet"
  horizon_url      = "https://horizon-testnet.stellar.org"
  allowed_origins  = "https://staging.${var.domain_name}"
  secrets_arn_prefix = "arn:aws:secretsmanager:${var.aws_region}:${data.aws_caller_identity.current.account_id}:secret:staging-finchippay"

  tags = {
    CostCenter = "staging"
  }
}
