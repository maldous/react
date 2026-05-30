# Infrastructure — Declarative Provisioning

Governed by [ADR-0023](../docs/adr/0023-define-declarative-infrastructure-provisioning-model.md).

## Ownership model

| Layer                                     | Tool                   | Scope                         |
| ----------------------------------------- | ---------------------- | ----------------------------- |
| Identity (Keycloak realm, clients, roles) | Terraform/OpenTofu     | `infra/modules/keycloak/`     |
| Cloud runtime (VPC, RDS, EKS, S3, IAM)    | Terraform/OpenTofu     | `infra/modules/aws-*/`        |
| CI/CD trust (OIDC, deploy roles)          | Terraform/OpenTofu     | `infra/modules/ci-oidc/`      |
| Local service startup                     | Docker Compose         | `compose.yaml`                |
| Database schema                           | Application migrations | `packages/adapters-postgres/` |
| Fixture data                              | Seed scripts           | dev/test only                 |

## Quick start

```sh
# Use the wrapper (tofu if available, else terraform)
./infra/bin/tf fmt -check -recursive infra/

# Provision dev Keycloak realm (requires Compose identity profile running)
# make compose-up-identity
./infra/bin/tf -chdir=infra/env/dev init -backend=false
./infra/bin/tf -chdir=infra/env/dev plan -var-file=dev.tfvars.example
./infra/bin/tf -chdir=infra/env/dev apply -var-file=dev.tfvars.example
```

## Environments

| Environment | State backend      | Secrets         | Users provisioned           |
| ----------- | ------------------ | --------------- | --------------------------- |
| `dev`       | Local (no backend) | `.env` file     | Fixture users (dev only)    |
| `test`      | Local (no backend) | `.env` file     | Fixture users (opt-in)      |
| `staging`   | Remote (S3)        | Secrets Manager | Fixture users (local stack) |
| `prod`      | Remote (S3)        | Secrets Manager | Fixture users (local stack) |

## Secrets policy

- No secrets committed. `.tfvars.example` files contain placeholder values only.
- Production secrets are Secrets Manager or Parameter Store references.
- `*.tfvars` and `*.auto.tfvars` are gitignored.
- `keycloak_is_local=true` must be set explicitly in tfvars to allow fixture user provisioning.

## Implementation status

| Module                       | Status                                                 |
| ---------------------------- | ------------------------------------------------------ |
| `modules/keycloak/`          | Done — ADR-ACT-0110 (mrparkers/keycloak v4.4.0)        |
| `modules/aws-network/`       | Planned — pre-production                               |
| `modules/aws-database/`      | Planned — pre-production                               |
| `modules/aws-observability/` | Planned — pre-production                               |
| `modules/ci-oidc/`           | Planned — pre-CI setup                                 |
| `env/dev/`                   | Done — ADR-ACT-0110 (calls keycloak module, validated) |
| `env/test/`                  | Done — ADR-ACT-0110                                    |
| `env/staging/`               | Done — ADR-ACT-0110                                    |
| `env/prod/`                  | Done — ADR-ACT-0110                                    |

## Validation commands

```sh
# Format + init + validate — offline, no Keycloak required
make infra-check

# Plan dev Keycloak provisioning — requires Keycloak running
docker compose --profile identity up -d keycloak
make keycloak-plan-dev

# Apply (when ready)
cp infra/env/dev/dev.tfvars.example infra/env/dev/dev.tfvars
# Edit dev.tfvars with real dev credentials
infra/bin/tf -chdir=infra/env/dev apply -var-file=dev.tfvars
```
