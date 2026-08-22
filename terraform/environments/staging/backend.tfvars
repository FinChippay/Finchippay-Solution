# terraform/environments/staging/backend.tfvars
# Remote state backend for the staging environment.
# Pass with: terraform init -backend-config="environments/staging/backend.tfvars"

bucket         = "finchippay-tf-state"
key            = "finchippay/staging/terraform.tfstate"
region         = "us-east-1"
dynamodb_table = "finchippay-tf-state-lock"
encrypt        = true