# terraform/providers.tf
# Provider requirements and configuration for the root module.
# Environment-specific backend configs live in terraform/environments/*/main.tf.

terraform {
  required_version = ">= 1.6.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project    = var.project
      ManagedBy  = "terraform"
      Repository = "FinChippay/Finchippay-Solution"
    }
  }
}
