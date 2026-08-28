# terraform/environments/staging/staging.tfvars
# Staging environment — medium instances, Multi-AZ database, HTTPS via ACM.

environment = "staging"

domain_name        = "staging.finchippay.example.com"
create_dns         = true
create_hosted_zone = true
hosted_zone_id     = ""

backend_image  = "finchippay/backend:latest"
frontend_image = "finchippay/frontend:latest"

backend_cpu            = "512"
backend_memory         = "1024"
frontend_cpu           = "256"
frontend_memory        = "512"
backend_desired_count  = 1
backend_min_capacity   = 1
backend_max_capacity   = 3
frontend_desired_count = 1
frontend_min_capacity  = 1
frontend_max_capacity  = 3
enable_autoscaling     = true

allowed_origins = "https://staging.finchippay.example.com"
stellar_network = "testnet"
horizon_url     = "https://horizon-testnet.stellar.org"

db_engine_version               = "16.3"
db_instance_class               = "db.t3.medium"
db_allocated_storage            = 50
db_max_allocated_storage        = 100
db_multi_az                     = true
db_backup_retention_days        = 14
db_performance_insights_enabled = true
db_deletion_protection          = false

redis_engine_version         = "7.1"
redis_node_type              = "cache.t3.medium"
redis_num_cache_nodes        = 2
redis_multi_az               = true
redis_authentication_enabled = true