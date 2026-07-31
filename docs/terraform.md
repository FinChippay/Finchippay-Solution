# Terraform Infrastructure — Finchippay

This document explains the Terraform modules that provision Finchippay's cloud infrastructure on **DigitalOcean** and walks through the full lifecycle from first-time setup to tear-down.

## Architecture

```
terraform/
├── main.tf                    # Root module — wires all child modules together
├── variables.tf               # All input variables with defaults and descriptions
├── outputs.tf                 # Root outputs (IPs, DB/Redis URLs, etc.)
├── providers.tf               # DigitalOcean + random providers
├── terraform.tfvars.example   # Copy → terraform.tfvars, fill in values
└── modules/
    ├── compute/               # DigitalOcean Droplet(s) + SSH key + project
    │   ├── main.tf
    │   ├── variables.tf
    │   └── outputs.tf
    ├── database/              # DigitalOcean Managed PostgreSQL cluster
    │   ├── main.tf
    │   ├── variables.tf
    │   └── outputs.tf
    └── redis/                 # DigitalOcean Managed Redis cluster
        ├── main.tf
        ├── variables.tf
        └── outputs.tf
```

All resources live in a **private VPC** and the database/Redis firewall rules permit connections only from the provisioned application Droplets.

### Resource summary

| Module | Resource | Purpose |
|---|---|---|
| root | `digitalocean_vpc` | Isolated private network |
| compute | `digitalocean_droplet` × N | Application servers running Docker Compose |
| compute | `digitalocean_ssh_key` | SSH access to Droplets |
| compute | `digitalocean_project` | Groups all resources in the DO control panel |
| database | `digitalocean_database_cluster` (pg) | Managed PostgreSQL 16 |
| database | `digitalocean_database_db` | Application database |
| database | `digitalocean_database_user` | Dedicated app user |
| database | `digitalocean_database_firewall` | Allow only app Droplets |
| redis | `digitalocean_database_cluster` (redis) | Managed Redis 7 |
| redis | `digitalocean_database_redis_config` | Sets eviction policy |
| redis | `digitalocean_database_firewall` | Allow only app Droplets |

## Prerequisites

- [Terraform](https://developer.hashicorp.com/terraform/install) ≥ 1.6
- A [DigitalOcean account](https://cloud.digitalocean.com/) with a **personal access token** (read + write scopes)
- An SSH key pair (`ssh-keygen -t ed25519` if you don't have one)

## Quick start

### 1. Configure variables

```bash
cd terraform/
cp terraform.tfvars.example terraform.tfvars
```

Edit `terraform.tfvars` and at minimum set:

```hcl
do_token            = "dop_v1_YOUR_TOKEN"
ssh_public_key_path = "~/.ssh/id_ed25519.pub"
```

Everything else has sensible defaults for a single-server deployment.

### 2. Initialise

```bash
terraform init
```

This downloads the DigitalOcean provider (`~2.39.x`) into `.terraform/`.

### 3. Plan

```bash
terraform plan
```

Review the output — it should show resources to be **created** with no errors.

### 4. Apply

```bash
terraform apply
```

Type `yes` when prompted. Provisioning takes roughly 5–10 minutes (managed databases take the longest).

### 5. Retrieve outputs

```bash
terraform output droplet_ipv4_addresses
terraform output -json   # all outputs as JSON

# Sensitive outputs require an explicit -raw or -json flag:
terraform output -raw database_url
terraform output -raw redis_url
```

Use the connection URLs in `backend/.env`:

```env
DATABASE_URL=$(terraform output -raw database_url)
REDIS_URL=$(terraform output -raw redis_url)
```

### 6. SSH into the Droplet

```bash
IP=$(terraform output -json droplet_ipv4_addresses | jq -r '.[0]')
ssh root@$IP
```

### 7. Deploy the application

Copy `docker-compose.prod.yml` to the Droplet and start the stack:

```bash
scp docker-compose.prod.yml backend/.env root@$IP:/opt/finchippay/
ssh root@$IP "cd /opt/finchippay && docker compose -f docker-compose.prod.yml up -d"
```

## Module reference

### `modules/compute`

| Variable | Default | Description |
|---|---|---|
| `name_prefix` | — | Resource name prefix |
| `region` | — | DO region slug |
| `droplet_size` | `s-2vcpu-4gb` | Droplet size slug |
| `droplet_image` | `docker-20-04` | Base OS image (Docker pre-installed) |
| `droplet_count` | `1` | Number of application Droplets |
| `vpc_id` | — | VPC to place Droplets in |
| `ssh_public_key` | — | SSH public key content |
| `tags` | `[]` | Tags applied to resources |

**Outputs:** `droplet_ids`, `droplet_ipv4_addresses`, `droplet_private_ipv4_addresses`, `ssh_key_fingerprint`, `project_id`

### `modules/database`

| Variable | Default | Description |
|---|---|---|
| `name_prefix` | — | Resource name prefix |
| `region` | — | DO region slug |
| `engine` | `pg` | Database engine |
| `engine_version` | `16` | PostgreSQL major version |
| `node_size` | `db-s-1vcpu-1gb` | Node size slug |
| `node_count` | `1` | Nodes (1 = standalone, 2+ = HA) |
| `database_name` | `finchippay` | Application database name |
| `database_user` | `finchippay_app` | Application database user |
| `vpc_id` | — | VPC for the cluster |
| `allowed_droplet_ids` | `[]` | Droplet IDs allowed through the firewall |
| `tags` | `[]` | Tags applied to resources |

**Outputs:** `cluster_id`, `host`, `private_host`, `port`, `database_name`, `user`, `password` *(sensitive)*, `connection_url` *(sensitive)*, `ca_cert` *(sensitive)*

### `modules/redis`

| Variable | Default | Description |
|---|---|---|
| `name_prefix` | — | Resource name prefix |
| `region` | — | DO region slug |
| `engine_version` | `7` | Redis major version |
| `node_size` | `db-s-1vcpu-1gb` | Node size slug |
| `node_count` | `1` | Number of nodes |
| `eviction_policy` | `allkeys-lru` | Maxmemory eviction policy |
| `vpc_id` | — | VPC for the cluster |
| `allowed_droplet_ids` | `[]` | Droplet IDs allowed through the firewall |
| `tags` | `[]` | Tags applied to resources |

**Outputs:** `cluster_id`, `host`, `private_host`, `port`, `password` *(sensitive)*, `connection_url` *(sensitive)*

## Remote state (optional but recommended for teams)

Uncomment the `backend "s3"` block in `providers.tf` to store state in a DigitalOcean Space:

```bash
# Create a Space and access key first, then:
export AWS_ACCESS_KEY_ID="<spaces-key-id>"
export AWS_SECRET_ACCESS_KEY="<spaces-secret>"
terraform init -reconfigure
```

## Environment sizing guide

| Environment | Droplet | DB node | Redis node |
|---|---|---|---|
| Staging | `s-1vcpu-2gb` | `db-s-1vcpu-1gb` | `db-s-1vcpu-1gb` |
| Production (small) | `s-2vcpu-4gb` | `db-s-2vcpu-4gb` | `db-s-1vcpu-2gb` |
| Production (HA) | `s-4vcpu-8gb` × 2 | `db-s-4vcpu-8gb`, 2 nodes | `db-s-2vcpu-4gb`, 2 nodes |

## Tear-down

```bash
terraform destroy
```

This permanently deletes all provisioned resources. Type `yes` when prompted.

> **Warning**: `terraform destroy` drops the managed database clusters and all data in them. Take a snapshot or backup before running this in a live environment.

## Security notes

- `do_token`, `database_password`, `redis_password`, `database_url`, and `redis_url` are all marked `sensitive = true`. Terraform will not display their values in plan/apply output.
- `terraform.tfvars` is excluded from version control via `.gitignore`. Use environment variables (`TF_VAR_*`) in CI/CD.
- All managed database clusters use TLS by default. The `connection_url` output uses `sslmode=require` for PostgreSQL and the `rediss://` scheme for Redis.
- Network access is restricted to application Droplets via firewall rules on each managed cluster.
