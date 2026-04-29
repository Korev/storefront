# GCP Backend Deployment Design

**Date:** 2026-04-28  
**Project:** vetfamily-494417  
**Scope:** Saleor Django backend (in `saleor/` subdirectory) deployed to GCP for the first time. Storefront is already on Cloud Run — this brings the backend to the same cloud and region.  
**Approach:** Terraform for infrastructure, Cloud Build for application deploys (Option B).

---

## 1. Services & Architecture

Six GCP services, all in `europe-north1` to match the existing storefront.

| Service       | GCP Product                 | Purpose                                   |
| ------------- | --------------------------- | ----------------------------------------- |
| Saleor API    | Cloud Run (min 1 instance)  | Django/Gunicorn, port 8000                |
| Celery worker | Cloud Run (min 1 instance)  | Background tasks, webhooks                |
| PostgreSQL    | Cloud SQL for PostgreSQL 15 | Primary database                          |
| Redis         | Memorystore for Redis 7     | Celery broker + Django cache              |
| Media storage | Cloud Storage bucket        | Product images, uploads                   |
| Secrets       | Secret Manager              | DATABASE_URL, REDIS_URL, SECRET_KEY, etc. |

**Connectivity:** Cloud SQL and Memorystore run on a private VPC (no public IP). Cloud Run services reach them via a Serverless VPC Access connector. Both Cloud Run services pull all secrets from Secret Manager at startup as environment variables.

**Image registry:** Artifact Registry (GCR is deprecated).  
Repository: `europe-north1-docker.pkg.dev/vetfamily-494417/petvamily/saleor-backend`

---

## 2. Terraform Structure

Terraform lives in a new top-level `infra/` directory (alongside `saleor/` and `storefront/`).

```
infra/
└── terraform/
    ├── main.tf           # provider config, GCP API enablement
    ├── variables.tf      # project_id, region, db password, etc.
    ├── outputs.tf        # Cloud Run URLs, Cloud SQL connection name
    ├── terraform.tfvars  # gitignored — actual values
    └── modules/
        ├── networking/   # VPC, subnet, Serverless VPC Access connector, private services peering
        ├── database/     # Cloud SQL instance, database, user, private IP binding
        ├── cache/        # Memorystore Redis instance
        ├── storage/      # GCS media bucket, CORS, IAM
        ├── secrets/      # Secret Manager secret shells (values set separately)
        └── iam/          # Service accounts for API + worker, role bindings, Cloud Build trigger
```

**Remote state:** stored in GCS bucket `vetfamily-494417-tfstate` with versioning enabled.

**What Terraform does NOT manage:**

- Cloud Run service revisions (image updates handled by Cloud Build via `gcloud run deploy`)
- Secret values (shells created by Terraform; values set once manually or via a secure bootstrap script)

---

## 3. Cloud Build Pipeline

New file: `saleor/cloudbuild.yaml`

**Steps:**

1. Build Docker image from `saleor/Dockerfile`
2. Push to Artifact Registry with `$BUILD_ID` and `latest` tags
3. Deploy API Cloud Run service — secrets injected as env vars from Secret Manager, VPC connector attached, `--min-instances=1`
4. Deploy Celery worker Cloud Run service — same image, entrypoint overridden to `celery -A saleor worker --loglevel=info`, same VPC connector, `--min-instances=1 --max-instances=3`

**Trigger:** Created via Terraform (in `iam/` module). Fires on push to `main` with path filter `saleor/**`. Runs on `E2_HIGHCPU_8`.

**Both Cloud Run services use a dedicated IAM service account** with minimal permissions:

- `roles/secretmanager.secretAccessor` — read secrets
- `roles/storage.objectAdmin` scoped to the media bucket — read/write uploads

**Secret environment variables injected at deploy time (not baked into image):**

- `DATABASE_URL` — Cloud SQL private IP connection string
- `REDIS_URL` — Memorystore private IP
- `SECRET_KEY` — Django secret key
- `ALLOWED_HOSTS` — Cloud Run service URL + custom domain
- `DEFAULT_FROM_EMAIL` — transactional email sender
- `SALEOR_APP_TOKEN` — for admin API access
- `STOREFRONT_URL` — storefront Cloud Run URL (for CORS, webhooks)

---

## 4. Networking & Security

**VPC layout:**

- VPC: `petvamily-vpc`
- Subnet: `petvamily-subnet`, CIDR `10.0.0.0/24`, region `europe-north1`
- Serverless VPC Access connector: CIDR `10.8.0.0/28` (Cloud Run → private services)
- Private Services Access peering: required for Cloud SQL private IP

**Cloud SQL (PostgreSQL 15):**

- Private IP only — no public IP
- Automated daily backups enabled
- Point-in-time recovery enabled
- `deletion_protection = true` in Terraform (prevents accidental `terraform destroy`)

**Memorystore (Redis 7):**

- Private IP only — no public exposure
- `BASIC` tier (no replication; upgradeable later)
- No AUTH required (inside VPC)

**GCS media bucket:**

- `allUsers` granted `roles/storage.objectViewer` (public read for product images)
- CORS configured to allow requests from storefront domain
- Soft delete and versioning disabled (media is re-uploadable)

**Firewall:** no inbound rules needed — Cloud Run is fully managed; VPC connector is outbound-only from Cloud Run's perspective.

---

## 5. File Changes Summary

| Action | Path                                                                                 |
| ------ | ------------------------------------------------------------------------------------ |
| Create | `infra/terraform/main.tf`                                                            |
| Create | `infra/terraform/variables.tf`                                                       |
| Create | `infra/terraform/outputs.tf`                                                         |
| Create | `infra/terraform/.gitignore` (ignore `terraform.tfvars`, `.terraform/`, `*.tfstate`) |
| Create | `infra/terraform/modules/networking/`                                                |
| Create | `infra/terraform/modules/database/`                                                  |
| Create | `infra/terraform/modules/cache/`                                                     |
| Create | `infra/terraform/modules/storage/`                                                   |
| Create | `infra/terraform/modules/secrets/`                                                   |
| Create | `infra/terraform/modules/iam/`                                                       |
| Create | `saleor/cloudbuild.yaml`                                                             |

The existing `saleor/deployment/elasticbeanstalk/` directory can be removed (superseded by this design).
