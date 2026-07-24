output "droplet_ids" {
  description = "IDs of the provisioned application Droplets."
  value       = [for d in digitalocean_droplet.app : tostring(d.id)]
}

output "droplet_ipv4_addresses" {
  description = "Public IPv4 addresses of the application Droplets."
  value       = [for d in digitalocean_droplet.app : d.ipv4_address]
}

output "droplet_private_ipv4_addresses" {
  description = "Private IPv4 addresses of the application Droplets (VPC-internal)."
  value       = [for d in digitalocean_droplet.app : d.ipv4_address_private]
}

output "ssh_key_fingerprint" {
  description = "MD5 fingerprint of the registered SSH public key."
  value       = digitalocean_ssh_key.app_key.fingerprint
}

output "project_id" {
  description = "ID of the DigitalOcean project grouping all resources."
  value       = digitalocean_project.app.id
}
