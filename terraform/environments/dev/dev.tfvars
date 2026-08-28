# terraform/environments/dev/dev.tfvars
# Development environment — small instances, single AZ, no Multi-AZ database.

environment = "dev"

domain_name        = "dev.finchippay.example.com"
create_dns         = false
create_hosted_zone = true
hosted_zone_id     = ""

backend_image  = "finchippay/backend:latest"
frontend_image = "finchippay/frontend:latest"

backend_cpu            = "256"
backend_memory         = "512"
frontend_cpu           = "256"
frontend_memory        = "512"
backend_desired_count  = 1
backend_min_capacity   = 1
backend_max_capacity   = 2
frontend_desired_count = 1
frontend_min_capacity  = 1
frontend_max_capacity  = 2
enable_autoscaling     = false

allowed_origins = "http://localhost:3000"
stellar_network = "testnet"
horizon_url     = "https://horizon-testnet.stellar.org"

db_engine_version               = "16.3"
db_instance_class               = "db.t3.micro"
db_allocated_storage            = 20
db_max_allocated_storage        = 40
db_multi_az                     = false
db_backup_retention_days        = 3
db_performance_insights_enabled = false
db_deletion_protection          = false

redis_engine_version         = "7.1"
redis_node_type              = "cache.t3.micro"
redis_num_cache_nodes        = 1
redis_multi_az               = false
redis_authentication_enabled = true