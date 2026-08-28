# terraform/environments/prod/prod.tfvars
# Production environment — large instances, Multi-AZ database + Redis,
# autoscaling enabled, HTTPS via ACM.

environment = "prod"

domain_name        = "finchippay.example.com"
create_dns         = true
create_hosted_zone = true
hosted_zone_id     = ""

backend_image  = "finchippay/backend:latest"
frontend_image = "finchippay/frontend:latest"

backend_cpu            = "1024"
backend_memory         = "2048"
frontend_cpu           = "512"
frontend_memory        = "1024"
backend_desired_count  = 2
backend_min_capacity   = 2
backend_max_capacity   = 6
frontend_desired_count = 2
frontend_min_capacity  = 2
frontend_max_capacity  = 6
enable_autoscaling     = true

allowed_origins = "https://finchippay.example.com"
stellar_network = "mainnet"
horizon_url     = "https://horizon.stellar.org"

db_engine_version               = "16.3"
db_instance_class               = "db.r6g.large"
db_allocated_storage            = 100
db_max_allocated_storage        = 200
db_multi_az                     = true
db_backup_retention_days        = 30
db_performance_insights_enabled = true
db_deletion_protection          = true

redis_engine_version         = "7.1"
redis_node_type              = "cache.r6g.large"
redis_num_cache_nodes        = 2
redis_multi_az               = true
redis_authentication_enabled = true