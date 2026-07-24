terraform {
  required_version = ">= 1.6.0"

  required_providers {
    digitalocean = {
      source  = "digitalocean/digitalocean"
      version = "~> 2.39.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6.0"
    }
  }

  # Uncomment to store state remotely (recommended for production):
  # backend "s3" {
  #   endpoint                    = "https://nyc3.digitaloceanspaces.com"
  #   bucket                      = "finchippay-tf-state"
  #   key                         = "finchippay/terraform.tfstate"
  #   region                      = "us-east-1"   # required by the s3 backend; ignored by DO Spaces
  #   skip_credentials_validation = true
  #   skip_metadata_api_check     = true
  #   skip_region_validation      = true
  #   force_path_style            = true
  # }
}

provider "digitalocean" {
  # Reads DIGITALOCEAN_TOKEN from the environment.
  # Set it before running terraform plan/apply:
  #   export DIGITALOCEAN_TOKEN="<your-personal-access-token>"
  token = var.do_token
}
