# Declarative infrastructure provisioning baseline evidence

## Summary

Ratified declarative infrastructure provisioning model before the first vertical slice (ADR-ACT-0008). Governed by ADR-0023.

## Governance

- ADR-0023 (accepted)
- ADR-ACT-0109 (Open ? create provisioning baseline and infra layout)
- ADR-ACT-0110 (Open ? create Keycloak Terraform/OpenTofu provisioning baseline)
- ADR-ACT-0008 (Open ? may proceed with fixture sessions; real SSO blocked until ADR-ACT-0110)
- Committed: 2026-05-28

## Selected provisioning tool

### Terraform/OpenTofu (HCL syntax)

| Tool | Status | Notes |
| --- | --- | --- |
| `terraform` | Available (v1.13.4 via tfenv) | Primary CLI in this environment |
| `tofu` | Not installed | Drop-in replacement; install when needed |
| `infra/bin/tf` | Created | Wrapper resolves to tofu ? terraform |

All documentation, Makefile targets, and CI pipelines use `infra/bin/tf` as the canonical command.

## Ownership split

### Terraform/OpenTofu owns

**Identity:**

- Keycloak realm, clients, scopes, protocol/claim mappers
- All 5 roles from ADR-0021 (system-admin, tenant-admin, manager, member, viewer)
- Redirect URIs and web origins (environment-specific)
- Fixture test users (local + development only; staging/production: none by default)

**Cloud infrastructure (when deployed):**

- VPC, subnets, security groups
- EKS/ECS/Fargate runtime
- RDS/PostgreSQL instance
- ElastiCache/Redis
- S3 buckets, IAM, KMS
- Secrets Manager, Parameter Store
- CloudWatch, DNS, TLS, load balancers

**CI/CD:**

- GitHub Actions OIDC trust
- Deployment IAM roles (per-environment)
- Artifact policies

### Docker Compose owns

Local service runtime startup only (lifecycle, not configuration):
postgres, redis, clickhouse, minio, mailpit, otel-collector, sonarqube, keycloak

Compose does not own Keycloak realm configuration ? that belongs to Terraform.

### Application migrations own

Database schema: tables, indexes, constraints, migration history.
Terraform creates the database instance; migrations create the schema.

### Seed scripts own

Fixture data for local and development environments only.
Staging and production are never seeded by default.

## Secrets policy

| Rule | Status |
| --- | --- |
| No secrets committed | Enforced ? .gitignore covers *.tfvars, .terraform/ |
| .tfvars.example with placeholders | Created for all environments |
| Production secrets via Secrets Manager | Policy established |
| Provider admin credentials | Never committed |

## Environment model

| Environment | Fixture users | State backend |
| --- | --- | --- |
| local | Yes (Terraform + local Keycloak) | Local (no backend) |
| development | Yes (controlled) | Remote (S3) |
| test | Yes (controlled) | Remote (S3) |
| staging | No | Remote (S3) |
| production | No | Remote (S3) |

## Repository layout created

```text
infra/
  README.md                          ? created
  bin/tf                             ? created (tofu ? terraform wrapper)
  .gitignore                         ? created
  modules/
    keycloak/                        ? scaffold (ADR-ACT-0110)
    aws-network/                     ? scaffold
    aws-database/                    ? scaffold
    aws-observability/               ? scaffold
    ci-oidc/                         ? scaffold
  env/
    local/                           ? scaffold + dev.tfvars.example
    development/                     ? scaffold + development.tfvars.example
    test/                            ? scaffold + test.tfvars.example
    staging/                         ? scaffold + staging.tfvars.example
    production/                      ? scaffold + production.tfvars.example
```

## Keycloak provisioning scope (ADR-ACT-0110)

When implemented, `infra/modules/keycloak/` will provision:

- Realm (token lifetimes, login policy, brute-force settings)
- SPA client (PKCE, redirect URIs from environment variables)
- BFF/API client (client credentials grant if required)
- Scopes and protocol mappers (tenant claims: organisationId, roles, permissions)
- All roles from ADR-0021
- Local/dev fixture users only (not staging/production)

Provider: `mrparkers/keycloak` (most mature, production-proven).

## ADR-ACT-0008 dependency

ADR-ACT-0008 (authenticated organisation profile slice) **may proceed** using:

- Pre-built `SessionActor` fixtures injected into BFF test/middleware layer
- Deterministic test session actors without live Keycloak

ADR-ACT-0008 **must not** claim real SSO login is complete.

Real Keycloak login is blocked until ADR-ACT-0110 is Done.

## Validation commands run

```text
make check                              ? all quality gates pass
npm run test:coverage                   ? 337/337 pass
node orchestrator all --no-reports --strict ? 6/6 passed
infra/bin/tf fmt -check -recursive infra/ ? no formatting errors (scaffold only)
```

## ADR-ACT-0008 status

**ADR-ACT-0008 (first vertical slice) has NOT started.**
