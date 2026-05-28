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
| Fixture data                              | Seed scripts           | local/development only        |

## Quick start

```sh
# Use the wrapper (tofu if available, else terraform)
./infra/bin/tf fmt -check -recursive infra/

# Provision local Keycloak realm (requires Compose identity profile running)
# make compose-up-identity
./infra/bin/tf -chdir=infra/env/local init -backend=false
./infra/bin/tf -chdir=infra/env/local plan -var-file=local.tfvars.example
./infra/bin/tf -chdir=infra/env/local apply -var-file=local.tfvars.example
```

## Environments

| Environment   | State backend      | Secrets         | Users provisioned          |
| ------------- | ------------------ | --------------- | -------------------------- |
| `local`       | Local (no backend) | `.env` file     | Fixture users (local only) |
| `development` | Remote (S3)        | CI secrets      | Fixture users              |
| `test`        | Remote (S3)        | CI secrets      | Fixture users              |
| `staging`     | Remote (S3)        | Secrets Manager | None by default            |
| `production`  | Remote (S3)        | Secrets Manager | None by default            |

## Secrets policy

- No secrets committed. `.tfvars.example` files contain placeholder values only.
- Production secrets are Secrets Manager or Parameter Store references.
- `terraform.tfvars` and `*.auto.tfvars` are gitignored.

## Implementation status

| Module                       | Status                   |
| ---------------------------- | ------------------------ |
| `modules/keycloak/`          | Planned — ADR-ACT-0110   |
| `modules/aws-network/`       | Planned — pre-production |
| `modules/aws-database/`      | Planned — pre-production |
| `modules/aws-observability/` | Planned — pre-production |
| `modules/ci-oidc/`           | Planned — pre-CI setup   |
| `env/local/`                 | Scaffold — ADR-ACT-0109  |
| `env/development/`           | Planned — ADR-ACT-0109   |
| `env/staging/`               | Planned — pre-production |
| `env/production/`            | Planned — pre-production |
