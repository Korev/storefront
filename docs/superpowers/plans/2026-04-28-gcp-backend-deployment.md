# GCP Backend Deployment — Terraform + Cloud Build Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deploy the Saleor Django backend (`saleor/`) to GCP project `vetfamily-494417` using Terraform for infrastructure and Cloud Build for application deploys.

**Architecture:** Terraform manages a private VPC, Cloud SQL (PostgreSQL 15), Memorystore (Redis 7), GCS media bucket, Secret Manager secrets, and IAM service accounts. Cloud Build builds the Docker image, pushes to Artifact Registry, and deploys two Cloud Run services: the Saleor API and a Celery worker.

**Tech Stack:** Terraform ≥ 1.8, Google provider ~> 6.0, Cloud Run v2, Cloud SQL PostgreSQL 15, Memorystore Redis 7, Artifact Registry, Secret Manager, Serverless VPC Access.

---

## File Map

> **Note:** All paths are relative to the `saleor/` git repo root (the `infra/` directory lives inside the saleor repo by design). Working directory for all commands: `/Users/georgy/src/petvamily/saleor/` (or the worktree at `.worktrees/gcp-backend-deployment/`).

```
infra/
└── terraform/
    ├── .gitignore
    ├── main.tf                      ← provider, API enablement, module wiring
    ├── variables.tf
    ├── outputs.tf
    ├── terraform.tfvars.example     ← committed, documents required vars
    └── modules/
        ├── networking/
        │   ├── main.tf              ← VPC, subnet, VPC connector, private peering
        │   ├── variables.tf
        │   └── outputs.tf
        ├── database/
        │   ├── main.tf              ← Cloud SQL instance, db, user
        │   ├── variables.tf
        │   └── outputs.tf
        ├── cache/
        │   ├── main.tf              ← Memorystore Redis instance
        │   ├── variables.tf
        │   └── outputs.tf
        ├── storage/
        │   ├── main.tf              ← GCS media bucket, CORS, public read IAM
        │   ├── variables.tf
        │   └── outputs.tf
        ├── secrets/
        │   ├── main.tf              ← Secret Manager shells (no values)
        │   └── outputs.tf
        └── iam/
            ├── main.tf              ← service accounts, role bindings, Artifact Registry, Cloud Build trigger
            ├── variables.tf
            └── outputs.tf

cloudbuild.yaml                      ← new: build + deploy API + deploy worker
scripts/
└── worker-entrypoint.sh             ← new: health-check server + celery exec
```

---

## Prerequisites (manual, one-time)

Before running `terraform apply`:

1. **Install the Cloud Build GitHub App** on your GitHub account/repo via GCP Console → Cloud Build → Triggers → Connect Repository. This OAuth step cannot be automated.
2. **Authenticate gcloud locally:** `gcloud auth application-default login`
3. **Set active project:** `gcloud config set project vetfamily-494417`

---

## Task 1: Bootstrap — tfstate bucket + root Terraform skeleton

**Files:**

- Create: `infra/terraform/.gitignore`
- Create: `infra/terraform/main.tf` (provider + backend only)
- Create: `infra/terraform/variables.tf`
- Create: `infra/terraform/outputs.tf` (empty for now)
- Create: `infra/terraform/terraform.tfvars.example`

- [ ] **Step 1: Create the tfstate GCS bucket (manual, run once)**

```bash
gsutil mb -p vetfamily-494417 -l europe-north1 gs://vetfamily-494417-tfstate
gsutil versioning set on gs://vetfamily-494417-tfstate
```

Expected: `Creating gs://vetfamily-494417-tfstate/...` then `Enabled versioning for gs://vetfamily-494417-tfstate/`

- [ ] **Step 2: Create `infra/terraform/.gitignore`**

```
.terraform/
*.tfstate
*.tfstate.backup
terraform.tfvars
```

- [ ] **Step 3: Create `infra/terraform/variables.tf`**

```hcl
variable "project_id" {
  description = "GCP project ID"
  type        = string
}

variable "region" {
  description = "GCP region for all resources"
  type        = string
  default     = "europe-north1"
}

variable "db_password" {
  description = "Cloud SQL saleor user password"
  type        = string
  sensitive   = true
}

variable "storefront_origins" {
  description = "Allowed CORS origins for the GCS media bucket (storefront URLs)"
  type        = list(string)
}

variable "github_owner" {
  description = "GitHub user or org that owns the repo"
  type        = string
}

variable "github_repo" {
  description = "GitHub repository name (without owner prefix)"
  type        = string
}
```

- [ ] **Step 4: Create `infra/terraform/main.tf`** (provider and backend only — module blocks added in Task 8)

```hcl
terraform {
  required_version = ">= 1.8"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
  }
  backend "gcs" {
    bucket = "vetfamily-494417-tfstate"
    prefix = "terraform/state"
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

resource "google_project_service" "apis" {
  for_each = toset([
    "compute.googleapis.com",
    "sqladmin.googleapis.com",
    "redis.googleapis.com",
    "storage.googleapis.com",
    "secretmanager.googleapis.com",
    "run.googleapis.com",
    "cloudbuild.googleapis.com",
    "vpcaccess.googleapis.com",
    "servicenetworking.googleapis.com",
    "artifactregistry.googleapis.com",
  ])
  service            = each.key
  disable_on_destroy = false
}
```

- [ ] **Step 5: Create `infra/terraform/outputs.tf`** (empty placeholder)

```hcl
# Populated in Task 8 after all modules are wired
```

- [ ] **Step 6: Create `infra/terraform/terraform.tfvars.example`**

```hcl
project_id         = "vetfamily-494417"
region             = "europe-north1"
db_password        = "change-me-use-a-strong-password"
storefront_origins = ["https://vetfamily-storefront-289757075353.europe-north1.run.app"]
github_owner       = "your-github-username"
github_repo        = "petvamily"
```

- [ ] **Step 7: Copy example to actual tfvars and fill in real values**

```bash
cp infra/terraform/terraform.tfvars.example infra/terraform/terraform.tfvars
# Edit terraform.tfvars with your actual github_owner and a strong db_password
```

- [ ] **Step 8: Initialize Terraform**

```bash
cd infra/terraform
terraform init
```

Expected: `Terraform has been successfully initialized!`

- [ ] **Step 9: Commit**

```bash
git add infra/terraform/.gitignore infra/terraform/main.tf infra/terraform/variables.tf \
        infra/terraform/outputs.tf infra/terraform/terraform.tfvars.example \
        infra/terraform/.terraform.lock.hcl
git commit -m "feat(infra): bootstrap Terraform root module with GCS backend"
```

---

## Task 2: Networking module

**Files:**

- Create: `infra/terraform/modules/networking/main.tf`
- Create: `infra/terraform/modules/networking/variables.tf`
- Create: `infra/terraform/modules/networking/outputs.tf`

- [ ] **Step 1: Create `infra/terraform/modules/networking/variables.tf`**

```hcl
variable "region" {
  type = string
}
```

- [ ] **Step 2: Create `infra/terraform/modules/networking/main.tf`**

```hcl
resource "google_compute_network" "vpc" {
  name                    = "petvamily-vpc"
  auto_create_subnetworks = false
}

resource "google_compute_subnetwork" "subnet" {
  name          = "petvamily-subnet"
  ip_cidr_range = "10.0.0.0/24"
  region        = var.region
  network       = google_compute_network.vpc.id
}

resource "google_compute_global_address" "private_ip_range" {
  name          = "petvamily-private-ip-range"
  purpose       = "VPC_PEERING"
  address_type  = "INTERNAL"
  prefix_length = 16
  network       = google_compute_network.vpc.id
}

resource "google_service_networking_connection" "private_vpc_connection" {
  network                 = google_compute_network.vpc.id
  service                 = "servicenetworking.googleapis.com"
  reserved_peering_ranges = [google_compute_global_address.private_ip_range.name]
}

resource "google_vpc_access_connector" "connector" {
  name          = "petvamily-vpc-connector"
  region        = var.region
  ip_cidr_range = "10.8.0.0/28"
  network       = google_compute_network.vpc.name
}
```

- [ ] **Step 3: Create `infra/terraform/modules/networking/outputs.tf`**

```hcl
output "vpc_id" {
  value = google_compute_network.vpc.id
}

output "vpc_name" {
  value = google_compute_network.vpc.name
}

output "vpc_connector_name" {
  value = google_vpc_access_connector.connector.name
}

output "private_vpc_connection_id" {
  value = google_service_networking_connection.private_vpc_connection.id
}
```

- [ ] **Step 4: Commit**

```bash
git add infra/terraform/modules/networking/
git commit -m "feat(infra): add networking module (VPC, subnet, VPC connector)"
```

---

## Task 3: Database module

**Files:**

- Create: `infra/terraform/modules/database/main.tf`
- Create: `infra/terraform/modules/database/variables.tf`
- Create: `infra/terraform/modules/database/outputs.tf`

- [ ] **Step 1: Create `infra/terraform/modules/database/variables.tf`**

```hcl
variable "region" {
  type = string
}

variable "vpc_id" {
  type = string
}

variable "db_password" {
  type      = string
  sensitive = true
}
```

- [ ] **Step 2: Create `infra/terraform/modules/database/main.tf`**

```hcl
resource "google_sql_database_instance" "postgres" {
  name             = "petvamily-postgres"
  database_version = "POSTGRES_15"
  region           = var.region

  deletion_protection = true

  settings {
    tier = "db-f1-micro"

    backup_configuration {
      enabled                        = true
      point_in_time_recovery_enabled = true
      start_time                     = "03:00"
    }

    ip_configuration {
      ipv4_enabled                                  = false
      private_network                               = var.vpc_id
      enable_private_path_for_google_cloud_services = true
    }
  }
}

resource "google_sql_database" "saleor" {
  name     = "saleor"
  instance = google_sql_database_instance.postgres.name
}

resource "google_sql_user" "saleor" {
  name     = "saleor"
  instance = google_sql_database_instance.postgres.name
  password = var.db_password
}
```

- [ ] **Step 3: Create `infra/terraform/modules/database/outputs.tf`**

```hcl
output "private_ip" {
  value     = google_sql_database_instance.postgres.private_ip_address
  sensitive = true
}

output "instance_name" {
  value = google_sql_database_instance.postgres.name
}

output "database_name" {
  value = google_sql_database.saleor.name
}

output "user_name" {
  value = google_sql_user.saleor.name
}
```

- [ ] **Step 4: Commit**

```bash
git add infra/terraform/modules/database/
git commit -m "feat(infra): add database module (Cloud SQL PostgreSQL 15)"
```

> **Note on ordering:** Cloud SQL with private IP requires the Private Services Access peering to exist first. The `depends_on = [module.networking]` on the database module call in Task 8 enforces this. Do not remove it.

---

## Task 4: Cache module

**Files:**

- Create: `infra/terraform/modules/cache/main.tf`
- Create: `infra/terraform/modules/cache/variables.tf`
- Create: `infra/terraform/modules/cache/outputs.tf`

- [ ] **Step 1: Create `infra/terraform/modules/cache/variables.tf`**

```hcl
variable "region" {
  type = string
}

variable "vpc_id" {
  type = string
}
```

- [ ] **Step 2: Create `infra/terraform/modules/cache/main.tf`**

```hcl
resource "google_redis_instance" "cache" {
  name               = "petvamily-redis"
  tier               = "BASIC"
  memory_size_gb     = 1
  region             = var.region
  authorized_network = var.vpc_id
  connect_mode       = "DIRECT_PEERING"
  redis_version      = "REDIS_7_0"
  display_name       = "Petvamily Redis"
}
```

- [ ] **Step 3: Create `infra/terraform/modules/cache/outputs.tf`**

```hcl
output "host" {
  value     = google_redis_instance.cache.host
  sensitive = true
}

output "port" {
  value = google_redis_instance.cache.port
}
```

- [ ] **Step 4: Commit**

```bash
git add infra/terraform/modules/cache/
git commit -m "feat(infra): add cache module (Memorystore Redis 7)"
```

---

## Task 5: Storage module

**Files:**

- Create: `infra/terraform/modules/storage/main.tf`
- Create: `infra/terraform/modules/storage/variables.tf`
- Create: `infra/terraform/modules/storage/outputs.tf`

- [ ] **Step 1: Create `infra/terraform/modules/storage/variables.tf`**

```hcl
variable "project_id" {
  type = string
}

variable "region" {
  type = string
}

variable "storefront_origins" {
  type        = list(string)
  description = "Allowed CORS origins for the media bucket"
}
```

- [ ] **Step 2: Create `infra/terraform/modules/storage/main.tf`**

```hcl
resource "google_storage_bucket" "media" {
  name          = "${var.project_id}-saleor-media"
  location      = var.region
  force_destroy = false

  uniform_bucket_level_access = true

  cors {
    origin          = var.storefront_origins
    method          = ["GET", "HEAD", "OPTIONS"]
    response_header = ["Content-Type", "Access-Control-Allow-Origin"]
    max_age_seconds = 3600
  }
}

resource "google_storage_bucket_iam_member" "public_read" {
  bucket = google_storage_bucket.media.name
  role   = "roles/storage.objectViewer"
  member = "allUsers"
}
```

- [ ] **Step 3: Create `infra/terraform/modules/storage/outputs.tf`**

```hcl
output "bucket_name" {
  value = google_storage_bucket.media.name
}

output "bucket_url" {
  value = "https://storage.googleapis.com/${google_storage_bucket.media.name}"
}
```

- [ ] **Step 4: Commit**

```bash
git add infra/terraform/modules/storage/
git commit -m "feat(infra): add storage module (GCS media bucket)"
```

---

## Task 6: IAM module

**Files:**

- Create: `infra/terraform/modules/iam/main.tf`
- Create: `infra/terraform/modules/iam/variables.tf`
- Create: `infra/terraform/modules/iam/outputs.tf`

- [ ] **Step 1: Create `infra/terraform/modules/iam/variables.tf`**

```hcl
variable "project_id" {
  type = string
}

variable "region" {
  type = string
}

variable "media_bucket_name" {
  type = string
}

variable "github_owner" {
  type = string
}

variable "github_repo" {
  type = string
}
```

- [ ] **Step 2: Create `infra/terraform/modules/iam/main.tf`**

```hcl
# Artifact Registry repository for backend images
resource "google_artifact_registry_repository" "backend" {
  location      = var.region
  repository_id = "petvamily"
  description   = "Docker images for petvamily services"
  format        = "DOCKER"
}

# Service account for Saleor API Cloud Run service
resource "google_service_account" "saleor_api" {
  account_id   = "saleor-api"
  display_name = "Saleor API Cloud Run"
}

# Service account for Celery worker Cloud Run service
resource "google_service_account" "saleor_worker" {
  account_id   = "saleor-worker"
  display_name = "Saleor Celery Worker Cloud Run"
}

# Service account for Cloud Build
resource "google_service_account" "cloudbuild" {
  account_id   = "saleor-cloudbuild"
  display_name = "Saleor Cloud Build"
}

# API service account: read secrets
resource "google_project_iam_member" "api_secret_accessor" {
  project = var.project_id
  role    = "roles/secretmanager.secretAccessor"
  member  = "serviceAccount:${google_service_account.saleor_api.email}"
}

# Worker service account: read secrets
resource "google_project_iam_member" "worker_secret_accessor" {
  project = var.project_id
  role    = "roles/secretmanager.secretAccessor"
  member  = "serviceAccount:${google_service_account.saleor_worker.email}"
}

# API service account: write/read GCS media bucket
resource "google_storage_bucket_iam_member" "api_storage_admin" {
  bucket = var.media_bucket_name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.saleor_api.email}"
}

# Worker service account: write/read GCS media bucket
resource "google_storage_bucket_iam_member" "worker_storage_admin" {
  bucket = var.media_bucket_name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.saleor_worker.email}"
}

# Cloud Build: deploy to Cloud Run
resource "google_project_iam_member" "cloudbuild_run_admin" {
  project = var.project_id
  role    = "roles/run.admin"
  member  = "serviceAccount:${google_service_account.cloudbuild.email}"
}

# Cloud Build: push images to Artifact Registry
resource "google_project_iam_member" "cloudbuild_ar_writer" {
  project = var.project_id
  role    = "roles/artifactregistry.writer"
  member  = "serviceAccount:${google_service_account.cloudbuild.email}"
}

# Cloud Build: act as Cloud Run service accounts during deploy
resource "google_project_iam_member" "cloudbuild_sa_user" {
  project = var.project_id
  role    = "roles/iam.serviceAccountUser"
  member  = "serviceAccount:${google_service_account.cloudbuild.email}"
}

# Cloud Build: write build logs
resource "google_project_iam_member" "cloudbuild_logs" {
  project = var.project_id
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${google_service_account.cloudbuild.email}"
}

# Cloud Build trigger — fires on push to main in saleor/ path
resource "google_cloudbuild_trigger" "saleor_backend" {
  name            = "saleor-backend-deploy"
  location        = var.region
  service_account = google_service_account.cloudbuild.id

  github {
    owner = var.github_owner
    name  = var.github_repo
    push {
      branch = "^main$"
    }
  }

  included_files = ["saleor/**"]
  filename       = "saleor/cloudbuild.yaml"
}
```

- [ ] **Step 3: Create `infra/terraform/modules/iam/outputs.tf`**

```hcl
output "api_service_account_email" {
  value = google_service_account.saleor_api.email
}

output "worker_service_account_email" {
  value = google_service_account.saleor_worker.email
}

output "artifact_registry_url" {
  value = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.backend.repository_id}"
}
```

- [ ] **Step 4: Commit**

```bash
git add infra/terraform/modules/iam/
git commit -m "feat(infra): add IAM module (service accounts, roles, AR repo, Cloud Build trigger)"
```

---

## Task 7: Secrets module

**Files:**

- Create: `infra/terraform/modules/secrets/main.tf`
- Create: `infra/terraform/modules/secrets/outputs.tf`

Note: This module creates Secret Manager _shells_ only. Actual values are populated in Task 13.

- [ ] **Step 1: Create `infra/terraform/modules/secrets/main.tf`**

```hcl
locals {
  secret_names = [
    "saleor-database-url",
    "saleor-redis-url",
    "saleor-secret-key",
    "saleor-allowed-hosts",
    "saleor-default-from-email",
    "saleor-app-token",
    "saleor-storefront-url",
    "saleor-gcs-media-bucket",
  ]
}

resource "google_secret_manager_secret" "secrets" {
  for_each  = toset(local.secret_names)
  secret_id = each.key

  replication {
    auto {}
  }
}
```

- [ ] **Step 2: Create `infra/terraform/modules/secrets/outputs.tf`**

```hcl
output "secret_ids" {
  value = { for k, v in google_secret_manager_secret.secrets : k => v.id }
}
```

- [ ] **Step 3: Commit**

```bash
git add infra/terraform/modules/secrets/
git commit -m "feat(infra): add secrets module (Secret Manager shells)"
```

---

## Task 8: Wire root module + validate

**Files:**

- Modify: `infra/terraform/main.tf` (add module blocks)
- Modify: `infra/terraform/outputs.tf` (add outputs)

- [ ] **Step 1: Replace `infra/terraform/main.tf`** with the full version including all module calls

```hcl
terraform {
  required_version = ">= 1.8"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
  }
  backend "gcs" {
    bucket = "vetfamily-494417-tfstate"
    prefix = "terraform/state"
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

resource "google_project_service" "apis" {
  for_each = toset([
    "compute.googleapis.com",
    "sqladmin.googleapis.com",
    "redis.googleapis.com",
    "storage.googleapis.com",
    "secretmanager.googleapis.com",
    "run.googleapis.com",
    "cloudbuild.googleapis.com",
    "vpcaccess.googleapis.com",
    "servicenetworking.googleapis.com",
    "artifactregistry.googleapis.com",
  ])
  service            = each.key
  disable_on_destroy = false
}

module "networking" {
  source     = "./modules/networking"
  region     = var.region
  depends_on = [google_project_service.apis]
}

module "database" {
  source      = "./modules/database"
  region      = var.region
  vpc_id      = module.networking.vpc_id
  db_password = var.db_password
  depends_on  = [module.networking]
}

module "cache" {
  source     = "./modules/cache"
  region     = var.region
  vpc_id     = module.networking.vpc_id
  depends_on = [google_project_service.apis]
}

module "storage" {
  source             = "./modules/storage"
  project_id         = var.project_id
  region             = var.region
  storefront_origins = var.storefront_origins
}

module "iam" {
  source            = "./modules/iam"
  project_id        = var.project_id
  region            = var.region
  media_bucket_name = module.storage.bucket_name
  github_owner      = var.github_owner
  github_repo       = var.github_repo
  depends_on        = [google_project_service.apis]
}

module "secrets" {
  source     = "./modules/secrets"
  depends_on = [google_project_service.apis]
}
```

- [ ] **Step 2: Replace `infra/terraform/outputs.tf`**

```hcl
output "vpc_connector_name" {
  value = module.networking.vpc_connector_name
}

output "db_private_ip" {
  value     = module.database.private_ip
  sensitive = true
}

output "redis_host" {
  value     = module.cache.host
  sensitive = true
}

output "redis_port" {
  value = module.cache.port
}

output "media_bucket_name" {
  value = module.storage.bucket_name
}

output "media_bucket_url" {
  value = module.storage.bucket_url
}

output "api_service_account_email" {
  value = module.iam.api_service_account_email
}

output "worker_service_account_email" {
  value = module.iam.worker_service_account_email
}

output "artifact_registry_url" {
  value = module.iam.artifact_registry_url
}
```

- [ ] **Step 3: Validate**

```bash
cd infra/terraform
terraform fmt -recursive
terraform validate
```

Expected: `Success! The configuration is valid.`

- [ ] **Step 4: Dry-run plan**

```bash
terraform plan
```

Expected: A plan showing ~25-30 resources to add, 0 to change, 0 to destroy. Verify that all six categories of resources appear: `google_compute_network`, `google_sql_database_instance`, `google_redis_instance`, `google_storage_bucket`, `google_secret_manager_secret`, `google_service_account`.

- [ ] **Step 5: Commit**

```bash
git add infra/terraform/main.tf infra/terraform/outputs.tf
git commit -m "feat(infra): wire all modules in root, validate full plan"
```

---

## Task 9: Worker entrypoint script

**Files:**

- Create: `scripts/worker-entrypoint.sh`

The Saleor Dockerfile CMD runs `uvicorn`. For the Celery worker Cloud Run service we need to override this. Cloud Run requires the container to listen on a port (for health probes), so we run a minimal Python HTTP server alongside Celery.

- [ ] **Step 1: Create `scripts/worker-entrypoint.sh`**

```bash
#!/bin/bash
set -e

# Cloud Run requires the container to listen on $PORT (default 8000) for health probes.
# Start a minimal HTTP server in the background, then exec Celery as PID 1.
python3 - <<'PYEOF' &
import http.server, os

class HealthHandler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b"ok")
    def log_message(self, *args):
        pass

port = int(os.environ.get("PORT", 8000))
http.server.HTTPServer(("0.0.0.0", port), HealthHandler).serve_forever()
PYEOF

exec celery -A saleor worker --loglevel=info
```

- [ ] **Step 2: Make the script executable**

```bash
chmod +x scripts/worker-entrypoint.sh
```

- [ ] **Step 3: Verify the script is included in the Docker build**

Check `Dockerfile` — it has `COPY . /app` which copies all files including `scripts/`. Confirm there is no `.dockerignore` entry that would exclude `scripts/`:

```bash
grep -r "scripts" .dockerignore 2>/dev/null || echo "No .dockerignore exclusion for scripts/"
```

- [ ] **Step 4: Commit**

```bash
git add scripts/worker-entrypoint.sh
git commit -m "feat(saleor): add worker entrypoint script for Cloud Run health-check compatibility"
```

---

## Task 10: Cloud Build pipeline

**Files:**

- Create: `cloudbuild.yaml`

- [ ] **Step 1: Create `cloudbuild.yaml`**

```yaml
steps:
  # Build image from saleor/ directory
  - name: gcr.io/cloud-builders/docker
    args:
      - build
      - -t=${_REGISTRY}/saleor-backend:$BUILD_ID
      - -t=${_REGISTRY}/saleor-backend:latest
      - .

  # Push both tags
  - name: gcr.io/cloud-builders/docker
    args: [push, --all-tags, ${_REGISTRY}/saleor-backend]

  # Deploy Saleor API
  - name: gcr.io/google.com/cloudsdktool/cloud-sdk
    entrypoint: gcloud
    args:
      - run
      - deploy
      - saleor-api
      - --image=${_REGISTRY}/saleor-backend:$BUILD_ID
      - --region=europe-north1
      - --platform=managed
      - --allow-unauthenticated
      - --port=8000
      - --memory=1Gi
      - --cpu=1
      - --min-instances=1
      - --max-instances=10
      - --service-account=${_API_SERVICE_ACCOUNT}
      - --vpc-connector=petvamily-vpc-connector
      - --vpc-egress=private-ranges-only
      - --set-secrets=DATABASE_URL=saleor-database-url:latest,REDIS_URL=saleor-redis-url:latest,SECRET_KEY=saleor-secret-key:latest,ALLOWED_HOSTS=saleor-allowed-hosts:latest,DEFAULT_FROM_EMAIL=saleor-default-from-email:latest,SALEOR_APP_TOKEN=saleor-app-token:latest,STOREFRONT_URL=saleor-storefront-url:latest,GCS_MEDIA_BUCKET_NAME=saleor-gcs-media-bucket:latest

  # Deploy Celery worker (same image, custom entrypoint)
  - name: gcr.io/google.com/cloudsdktool/cloud-sdk
    entrypoint: gcloud
    args:
      - run
      - deploy
      - saleor-worker
      - --image=${_REGISTRY}/saleor-backend:$BUILD_ID
      - --region=europe-north1
      - --platform=managed
      - --no-allow-unauthenticated
      - --port=8000
      - --memory=1Gi
      - --cpu=1
      - --min-instances=1
      - --max-instances=3
      - --service-account=${_WORKER_SERVICE_ACCOUNT}
      - --vpc-connector=petvamily-vpc-connector
      - --vpc-egress=private-ranges-only
      - --command=/app/scripts/worker-entrypoint.sh
      - --set-secrets=DATABASE_URL=saleor-database-url:latest,REDIS_URL=saleor-redis-url:latest,SECRET_KEY=saleor-secret-key:latest,STOREFRONT_URL=saleor-storefront-url:latest,GCS_MEDIA_BUCKET_NAME=saleor-gcs-media-bucket:latest

substitutions:
  _REGISTRY: europe-north1-docker.pkg.dev/$PROJECT_ID/petvamily
  _API_SERVICE_ACCOUNT: saleor-api@vetfamily-494417.iam.gserviceaccount.com
  _WORKER_SERVICE_ACCOUNT: saleor-worker@vetfamily-494417.iam.gserviceaccount.com

images:
  - europe-north1-docker.pkg.dev/$PROJECT_ID/petvamily/saleor-backend:$BUILD_ID
  - europe-north1-docker.pkg.dev/$PROJECT_ID/petvamily/saleor-backend:latest

options:
  machineType: E2_HIGHCPU_8
  logging: CLOUD_LOGGING_ONLY
```

- [ ] **Step 2: Commit**

```bash
git add cloudbuild.yaml
git commit -m "feat(saleor): add Cloud Build pipeline for GCP deployment"
```

---

## Task 11: Remove Elastic Beanstalk config

**Files:**

- Delete: `deployment/elasticbeanstalk/Dockerrun.aws.json`
- Delete: `deployment/elasticbeanstalk/` (directory)

- [ ] **Step 1: Remove the EB deployment directory**

```bash
git rm -r deployment/elasticbeanstalk/
```

Expected: `rm 'deployment/elasticbeanstalk/Dockerrun.aws.json'`

- [ ] **Step 2: Check if `deployment/` is now empty**

```bash
ls deployment/
```

If empty, remove the parent too:

```bash
git rm -r deployment/
```

- [ ] **Step 3: Commit**

```bash
git commit -m "chore(saleor): remove Elastic Beanstalk deployment config (replaced by GCP Cloud Run)"
```

---

## Task 12: Apply Terraform

- [ ] **Step 1: Verify prerequisites are complete**

```bash
gcloud auth application-default print-access-token > /dev/null && echo "Auth OK"
gcloud config get-value project
# Expected: vetfamily-494417
```

Also confirm GitHub repo is connected to Cloud Build: GCP Console → Cloud Build → Triggers → check that `petvamily` repo appears under connected repositories.

- [ ] **Step 2: Apply**

```bash
cd infra/terraform
terraform apply
```

Review the plan output. Confirm ~25-30 resources. Type `yes` when prompted.

Note: Cloud SQL creation takes ~10 minutes. Memorystore takes ~5 minutes. Total apply time: ~15-20 minutes.

- [ ] **Step 3: Capture outputs**

```bash
terraform output
terraform output -json > /tmp/tf-outputs.json
cat /tmp/tf-outputs.json
```

Note the values for `db_private_ip`, `redis_host`, `redis_port`, and `media_bucket_name` — needed in the next task.

---

## Task 13: Populate Secret Manager values + trigger first deploy

**Prerequisites:** Terraform applied successfully (Task 12). You have the outputs from `terraform output`.

- [ ] **Step 1: Populate each secret**

Replace `<VALUE>` with the actual value. `db_private_ip` and `redis_host` come from `terraform output`.

```bash
# DATABASE_URL — postgres://<user>:<password>@<private_ip>/<db>
echo -n "postgres://saleor:<YOUR_DB_PASSWORD>@$(terraform output -raw db_private_ip)/saleor" \
  | gcloud secrets versions add saleor-database-url --data-file=-

# REDIS_URL
echo -n "redis://$(terraform output -raw redis_host):$(terraform output -raw redis_port)/0" \
  | gcloud secrets versions add saleor-redis-url --data-file=-

# SECRET_KEY — generate a strong random key
echo -n "$(python3 -c 'import secrets; print(secrets.token_urlsafe(50))')" \
  | gcloud secrets versions add saleor-secret-key --data-file=-

# ALLOWED_HOSTS — will be updated after first deploy reveals the Cloud Run URL;
# use a placeholder for now then update after first deploy
echo -n "localhost" \
  | gcloud secrets versions add saleor-allowed-hosts --data-file=-

# DEFAULT_FROM_EMAIL
echo -n "noreply@petvamily.com" \
  | gcloud secrets versions add saleor-default-from-email --data-file=-

# SALEOR_APP_TOKEN — generate or leave empty for now
echo -n "" \
  | gcloud secrets versions add saleor-app-token --data-file=-

# STOREFRONT_URL
echo -n "https://vetfamily-storefront-289757075353.europe-north1.run.app" \
  | gcloud secrets versions add saleor-storefront-url --data-file=-

# GCS_MEDIA_BUCKET_NAME
echo -n "$(terraform output -raw media_bucket_name)" \
  | gcloud secrets versions add saleor-gcs-media-bucket --data-file=-
```

- [ ] **Step 2: Trigger first Cloud Build deploy manually**

```bash
cd saleor
gcloud builds submit \
  --config=cloudbuild.yaml \
  --project=vetfamily-494417 \
  --region=europe-north1 \
  .
```

Build takes ~8-12 minutes. Watch progress:

```bash
# In a second terminal — list recent builds
gcloud builds list --region=europe-north1 --limit=3
```

- [ ] **Step 3: Get the deployed API URL and update ALLOWED_HOSTS**

```bash
gcloud run services describe saleor-api \
  --region=europe-north1 \
  --format="value(status.url)"
```

Update the secret with the real URL:

```bash
SALEOR_URL=$(gcloud run services describe saleor-api --region=europe-north1 --format="value(status.url)")
echo -n "${SALEOR_URL#https://}" \
  | gcloud secrets versions add saleor-allowed-hosts --data-file=-
```

- [ ] **Step 4: Verify API is serving**

```bash
curl -s "$SALEOR_URL/graphql/" -X POST \
  -H "Content-Type: application/json" \
  -d '{"query": "{ shop { name } }"}' | python3 -m json.tool
```

Expected: JSON response with `{ "data": { "shop": { "name": "..." } } }`

- [ ] **Step 5: Verify Celery worker is running**

```bash
gcloud run services describe saleor-worker \
  --region=europe-north1 \
  --format="value(status.conditions[0].status)"
```

Expected: `True` (service is ready)

Check logs:

```bash
gcloud logging read \
  'resource.type="cloud_run_revision" AND resource.labels.service_name="saleor-worker"' \
  --limit=20 \
  --format="value(textPayload)"
```

Expected: Celery startup lines like `[celery@...] ready.`
