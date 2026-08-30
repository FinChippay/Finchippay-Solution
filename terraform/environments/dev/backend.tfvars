# terraform/environments/dev/backend.tfvars
# Remote state backend for the dev environment.
# Pass with: terraform init -backend-config="environments/dev/backend.tfvars"

bucket         = "finchippay-tf-state"
key            = "finchippay/dev/terraform.tfstate"
region         = "us-east-1"
dynamodb_table = "finchippay-tf-state-lock"
encrypt        = true