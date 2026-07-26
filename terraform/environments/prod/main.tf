# terraform/environments/prod/main.tf
# Production environment — three AZs, large sizing, multi-AZ DB, full HA.
# Use: terraform -chdir=terraform/environments/prod plan
# WARNING: Changes to this environment affect live traffic.

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
  #   key            = "prod/terraform.tfstate"
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
      Environment = "prod"
      ManagedBy   = "terraform"
      Repository  = "FinChippay/Finchippay-Solution"
    }
  }
}

data "aws_caller_identity" "current" {}

module "finchippay" {
  source = "../../"

  project        = "finchippay"
  environment    = "prod"
  aws_region     = var.aws_region
  aws_account_id = data.aws_caller_identity.current.account_id

  # Networking — three AZs, one NAT per AZ (full HA)
  availability_zones    = var.availability_zones
  vpc_cidr              = "10.30.0.0/16"
  public_subnet_cidrs   = ["10.30.1.0/24", "10.30.2.0/24", "10.30.3.0/24"]
  private_subnet_cidrs  = ["10.30.11.0/24", "10.30.12.0/24", "10.30.13.0/24"]
  database_subnet_cidrs = ["10.30.21.0/24", "10.30.22.0/24", "10.30.23.0/24"]
  single_nat_gateway    = false
  enable_flow_logs      = true

  # Compute — production sizing with auto-scaling
  backend_cpu            = 1024
  backend_memory         = 2048
  frontend_cpu           = 512
  frontend_memory        = 1024
  backend_desired_count  = 3
  frontend_desired_count = 3
  backend_min_count      = 2
  backend_max_count      = 20
  frontend_min_count     = 2
  frontend_max_count     = 10
  log_retention_days     = 90

  # Database — large instance, Multi-AZ, 30-day backups, performance insights
  db_instance_class      = "db.r6g.large"
  db_allocated_storage   = 100
  db_multi_az            = true
  db_backup_retention    = 30
  db_performance_insights = true

  # Cache — medium node, primary + replica in separate AZs
  redis_node_type    = "cache.r6g.large"
  redis_num_clusters = 2
  redis_multi_az     = true

  # DNS
  domain_name      = var.domain_name
  create_zone      = var.create_zone
  existing_zone_id = var.existing_zone_id

  # Application
  stellar_network  = "mainnet"
  horizon_url      = "https://horizon.stellar.org"
  allowed_origins  = "https://${var.domain_name},https://www.${var.domain_name}"
  secrets_arn_prefix = "arn:aws:secretsmanager:${var.aws_region}:${data.aws_caller_identity.current.account_id}:secret:prod-finchippay"

  tags = {
    CostCenter  = "prod"
    Criticality = "high"
  }
}
