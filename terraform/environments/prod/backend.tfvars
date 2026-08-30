# terraform/environments/prod/backend.tfvars
# Remote state backend for the production environment.
# Pass with: terraform init -backend-config="environments/prod/backend.tfvars"

bucket         = "finchippay-tf-state"
key            = "finchippay/prod/terraform.tfstate"
region         = "us-east-1"
dynamodb_table = "finchippay-tf-state-lock"
encrypt        = true