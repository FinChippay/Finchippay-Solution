terraform {
  required_version = ">= 1.6.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.40.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6.0"
    }
  }

  # Remote state backend — S3 bucket + DynamoDB lock table.
  #
  # Bootstrap once per AWS account before the first apply:
  #   aws s3api create-bucket --bucket finchippay-tf-state --region us-east-1
  #   aws dynamodb create-table \
  #     --table-name finchippay-tf-state-lock \
  #     --attribute-definitions AttributeName=LockID,AttributeType=S \
  #     --key-schema AttributeName=LockID,KeyType=HASH \
  #     --billing-mode PAY_PER_REQUEST
  #
  # CI overrides these values via -backend-config (see terraform/environments/*).
  # Use `terraform init -backend=false` for local fmt/validate checks.
  backend "s3" {
    bucket         = "finchippay-tf-state"
    key            = "finchippay/terraform.tfstate"
    region         = "us-east-1"
    dynamodb_table = "finchippay-tf-state-lock"
    encrypt        = true
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = var.project_name
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}