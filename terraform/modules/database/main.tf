# ─── terraform/modules/database/main.tf ───────────────────────────────────────
#
# Provisions a DigitalOcean Managed PostgreSQL cluster, an application
# database, and a dedicated database user. The cluster is placed inside
# the shared VPC and accepts connections only from the Droplets listed
# in var.allowed_droplet_ids.
# ──────────────────────────────────────────────────────────────────────────────

resource "digitalocean_database_cluster" "postgres" {
  name       = "${var.name_prefix}-postgres"
  engine     = var.engine
  version    = var.engine_version
  size       = var.node_size
  region     = var.region
  node_count = var.node_count

  private_network_uuid = var.vpc_id

  tags = var.tags
}

# Application database inside the cluster
resource "digitalocean_database_db" "app_db" {
  cluster_id = digitalocean_database_cluster.postgres.id
  name       = var.database_name
}

# Dedicated application user
resource "digitalocean_database_user" "app_user" {
  cluster_id = digitalocean_database_cluster.postgres.id
  name       = var.database_user
}

# Firewall: allow only listed Droplets to reach the cluster
resource "digitalocean_database_firewall" "postgres_fw" {
  cluster_id = digitalocean_database_cluster.postgres.id

  dynamic "rule" {
    for_each = var.allowed_droplet_ids
    content {
      type  = "droplet"
      value = rule.value
    }
  }
}
