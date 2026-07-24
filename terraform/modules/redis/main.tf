# ─── terraform/modules/redis/main.tf ──────────────────────────────────────────
#
# Provisions a DigitalOcean Managed Redis cluster inside the shared VPC.
# The cluster is accessible only to the Droplets listed in
# var.allowed_droplet_ids.
# ──────────────────────────────────────────────────────────────────────────────

resource "digitalocean_database_cluster" "redis" {
  name       = "${var.name_prefix}-redis"
  engine     = "redis"
  version    = var.engine_version
  size       = var.node_size
  region     = var.region
  node_count = var.node_count

  private_network_uuid = var.vpc_id

  tags = var.tags
}

# Eviction policy — set after cluster creation
resource "digitalocean_database_redis_config" "config" {
  cluster_id      = digitalocean_database_cluster.redis.id
  maxmemory_policy = var.eviction_policy
}

# Firewall: allow only listed Droplets to connect
resource "digitalocean_database_firewall" "redis_fw" {
  cluster_id = digitalocean_database_cluster.redis.id

  dynamic "rule" {
    for_each = var.allowed_droplet_ids
    content {
      type  = "droplet"
      value = rule.value
    }
  }
}
