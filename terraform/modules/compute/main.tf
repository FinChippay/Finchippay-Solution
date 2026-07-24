# ─── terraform/modules/compute/main.tf ────────────────────────────────────────
#
# Provisions one or more DigitalOcean Droplets that run the Finchippay
# application stack (frontend + backend containers via Docker Compose).
#
# Resources:
#   • SSH key registered with DigitalOcean
#   • Application Droplet(s) in the shared VPC
#   • A project to group all resources in the DO control panel
# ──────────────────────────────────────────────────────────────────────────────

# Register the SSH public key with DigitalOcean
resource "digitalocean_ssh_key" "app_key" {
  name       = "${var.name_prefix}-ssh-key"
  public_key = var.ssh_public_key
}

# Application Droplet(s)
resource "digitalocean_droplet" "app" {
  count  = var.droplet_count
  name   = var.droplet_count == 1 ? "${var.name_prefix}-app" : "${var.name_prefix}-app-${count.index + 1}"
  image  = var.droplet_image
  size   = var.droplet_size
  region = var.region

  # Place the Droplet in the shared private VPC
  vpc_uuid = var.vpc_id

  # Authorised SSH key
  ssh_keys = [digitalocean_ssh_key.app_key.fingerprint]

  # Enable backups for single-droplet deployments in production
  backups = var.droplet_count == 1 ? true : false

  # Cloud-init user data: install Docker Compose and pull the latest image
  user_data = <<-EOT
    #!/bin/bash
    set -euo pipefail

    # Update and install dependencies
    apt-get update -y
    apt-get install -y ca-certificates curl gnupg lsb-release

    # Add Docker's official GPG key
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
      | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    chmod a+r /etc/apt/keyrings/docker.gpg

    # Add Docker repository
    echo \
      "deb [arch=$(dpkg --print-architecture) \
      signed-by=/etc/apt/keyrings/docker.gpg] \
      https://download.docker.com/linux/ubuntu \
      $(lsb_release -cs) stable" \
      | tee /etc/apt/sources.list.d/docker.list > /dev/null

    apt-get update -y
    apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

    # Enable Docker on boot
    systemctl enable docker
    systemctl start docker

    # Create app directory
    mkdir -p /opt/finchippay
    echo "Droplet bootstrap complete" > /opt/finchippay/bootstrap.log
  EOT

  tags = concat(var.tags, ["role:app"])

  lifecycle {
    # Replace the Droplet if the base image changes, but not for
    # cloud-init updates (handled by a deployment script).
    create_before_destroy = true
  }
}

# Group all Finchippay resources under a single DigitalOcean project
resource "digitalocean_project" "app" {
  name        = var.name_prefix
  description = "Finchippay application infrastructure"
  purpose     = "Web Application"
  environment = title(split("-", var.name_prefix)[1])

  resources = concat(
    [for d in digitalocean_droplet.app : d.urn],
  )
}
