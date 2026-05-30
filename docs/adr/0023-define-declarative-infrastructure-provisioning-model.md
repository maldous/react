# ADR-0023: Define declarative infrastructure provisioning model

## Status

Accepted

## Date

2026-05-28

## Decision owner

Architecture owner / technical lead

## Consulted

- ADR-0001 (hexagonal architecture ? adapters own external integrations)
- ADR-0003 (modular monorepo ? delivery packages)
- ADR-0007 (repository layout ? delivery domain)
- ADR-0017 (Compose substrate ? local service runtime)
- ADR-0021 (identity model ? roles and permissions to provision)
- ADR-0022 (auth/session boundary ? Keycloak as adapter)

## Context

The platform has:

- `packages/adapters-keycloak` defining the SSO integration boundary
- `packages/tooling-terraform` as a placeholder delivery package
- Docker Compose for local service runtime
- ADR-0022 requiring Keycloak as the baseline IdP

Without a ratified provisioning model, these questions remain unanswered:

- Which environment resources are owned by Terraform/OpenTofu vs Compose vs application migrations?
- Can Keycloak realm configuration be committed as manual console steps?
- Where do secrets live?
- What does an `infra/` repository layout look like?
- Is the primary CLI `terraform` or `tofu`?

This ADR defines the ownership boundary and provisioning model before ADR-ACT-0110 (Keycloak Terraform baseline) begins.

## Stakeholder concerns

- **Security:** No secrets committed. No admin credentials in version control. Production identity configuration must be fully reproducible from committed code.
- **Operations:** Every environment (development, staging, production) must be provisionable deterministically from the infra/ directory without manual console steps.
- **Engineering:** Local development must not require cloud credentials. Compose owns local service startup; Terraform/OpenTofu owns durable configuration.
- **Compliance:** Keycloak realm, roles, and client configuration must be auditable through version control ? not through manual console history.
- **Architecture:** Terraform/OpenTofu must not create application tables. Application migrations own schema. Seed scripts own fixture data.

## Decision drivers

1. Manual console configuration is not an accepted baseline for committed environments ? it is not reproducible, auditable, or reviewable.
2. Compose is not a provisioning tool ? it starts services; it does not configure them.
3. Secrets must not be committed. Terraform/OpenTofu uses secret manager references or environment variables.
4. The provisioning tool must be OpenTofu-compatible to preserve vendor-neutral optionality.
5. Validation must be possible without live cloud credentials (syntax, format, plan with example vars).

## Options considered

### Option A: Ansible

Pros: Flexible; good for imperative config.

Cons: Not declarative-first; no plan/apply model; state management is implicit; not the standard for cloud infrastructure. Keycloak Ansible modules exist but community-maintained.

### Option B: Pulumi

Pros: TypeScript-native; type-safe.

Cons: Vendor lock-in for state backend; TypeScript-first forces a learning curve for infra-specific contributors; smaller Keycloak provider ecosystem.

### Option C: Terraform/OpenTofu (chosen)

Pros:

- Terraform Keycloak provider (`mrparkers/keycloak`) is the most mature and production-proven.
- OpenTofu-compatible syntax preserves vendor neutrality and BSL optionality.
- `terraform plan` / `tofu plan` gives auditable change previews.
- Wide ecosystem for AWS, Keycloak, GitHub, observability providers.
- HCL is readable by non-engineers in PR review.

Cons:

- State management requires a backend (S3 + DynamoDB for lock or equivalent).
- Local development requires `terraform init` even for syntax checks.

## Decision

---

### 1. Primary tooling

The repository uses **OpenTofu-compatible Terraform HCL syntax**.

**CLI policy:**

- Primary: `terraform` (Terraform 1.13.4 available at `.tfenv/bin/terraform`)
- Future: `tofu` when installed (OpenTofu is a drop-in replacement for this codebase)
- Wrapper script: `infra/bin/tf` resolves to `tofu` if available, falls back to `terraform`
- All documentation and Makefile targets use `tf` (the wrapper) as the canonical command

**Validation without cloud credentials:**

```sh
terraform fmt -check -recursive infra/
terraform init -backend=false infra/
terraform validate infra/
```

---

### 2. Ownership model

#### Terraform/OpenTofu owns

**Identity:**

- Keycloak realm (name, token lifetimes, login policy, SMTP settings)
- Keycloak clients (SPA client, BFF/API client)
- Client scopes and protocol mappers (claim mappers, audience mappers)
- Roles (all roles defined in ADR-0021: system-admin, tenant-admin, manager, member, viewer)
- Groups (if used for role assignment)
- Redirect URIs and web origins (environment-specific)
- Local/dev fixture test users (local and development environments only; staging/production: none by default)

**Cloud infrastructure (when deployed):**

- VPC, subnets, route tables, security groups
- EKS/ECS/Fargate or equivalent container runtime
- RDS/PostgreSQL (instance, database, credentials via Secrets Manager)
- ElastiCache/Redis
- S3 buckets (object storage, log storage, artifact storage)
- IAM roles, policies, instance profiles
- KMS keys and key policies
- Secrets Manager secrets (references; values populated out-of-band or via CI)
- Parameter Store entries
- CloudWatch log groups, metric filters, dashboards
- DNS records (Route 53 hosted zones and records)
- TLS certificates (ACM)
- Load balancers, target groups, listener rules
- Container registry (ECR) repositories and lifecycle policies

**Observability:**

- OTel collector deployment configuration where self-hosted
- Log retention policies
- Alert routing destinations (PagerDuty, OpsGenie, Slack webhooks as references)
- Sentry project references (via Sentry Terraform provider where supported)
- Grafana Cloud datasource references where provider/API supports it

**CI/CD:**

- OIDC trust between CI provider (GitHub Actions) and cloud account
- Deployment IAM roles (per-environment, least-privilege)
- Artifact bucket policies
- Environment-specific deploy permissions

**Security:**

- Service accounts and workload identity
- Least-privilege IAM
- Secret references (not values)
- Audit log sinks
- Backup retention policies

#### Docker Compose owns

Compose owns **local service runtime startup only**. It does not own durable environment configuration.

| Service              | Compose scope                                                |
| -------------------- | ------------------------------------------------------------ |
| local Postgres       | Container lifecycle, default credentials                     |
| local Redis          | Container lifecycle                                          |
| local ClickHouse     | Container lifecycle, credentials                             |
| local MinIO          | Container lifecycle, access keys                             |
| local Mailpit        | Container lifecycle                                          |
| local OTel Collector | Container lifecycle, config file mount                       |
| local SonarQube      | Container lifecycle                                          |
| local Keycloak       | Container lifecycle only ? realm config belongs to Terraform |

**Rule:** If a Compose service requires non-trivial configuration beyond startup, that configuration must be:

- Represented as Terraform/OpenTofu if it mirrors real infrastructure (e.g., Keycloak realm), OR
- Represented as an explicit local bootstrap fixture script if local-only and deliberately not mirroring real infrastructure.

#### Application migrations own

- Database schema (`CREATE TABLE`, `ALTER TABLE`)
- Indexes, constraints, triggers
- Migration history table
- Baseline application tables and sequences

**Rule:** Terraform/OpenTofu must not create application tables. Terraform creates the database instance and credentials. The application migration runner creates the schema.

#### Seed scripts own

- Demo users, local organisations, test memberships (local and development environments)
- Fixture data for automated tests
- Local only ? seed scripts must not run in staging or production without explicit gating

---

### 3. Secrets policy

Rules:

- No secrets committed to version control ? not in `.tf` files, not in `.tfvars`, not in CI config.
- Generated client secrets are populated out-of-band or via CI secret injection into Secrets Manager.
- Provider admin credentials (Keycloak admin password, cloud root credentials) are never committed.
- `.tfvars.example` files may contain obviously-fake placeholder values only.
- Production secrets are external references (Secrets Manager ARN, Parameter Store path) resolved at runtime.
- `terraform.tfvars` and `*.auto.tfvars` files are gitignored globally.

---

### 4. Environment model

| Environment   | APEX_DOMAIN           | KC_HOSTNAME                      | Users                                                  | Secrets           | Config scope                                                           |
| ------------- | --------------------- | -------------------------------- | ------------------------------------------------------ | ----------------- | ---------------------------------------------------------------------- |
| `local`       | `dev.localhost`       | `http://dev.localhost/kc`        | Fixture users (Terraform-provisioned or script-seeded) | Local `.env` file | Compose + local Terraform (no state backend required)                  |
| `development` | `dev.localhost`       | `http://dev.localhost/kc`        | Controlled fixture users                               | CI secrets        | Terraform with remote state                                            |
| `test`        | `test.localhost`      | `http://test.localhost/kc`       | Controlled fixture users                               | CI secrets        | Terraform with remote state                                            |
| `staging`     | `staging.aldous.info` | `https://staging.aldous.info/kc` | No users provisioned by default                        | Secrets Manager   | Terraform with remote state                                            |
| `production`  | `aldous.info`         | `https://aldous.info/kc`         | No users provisioned by default                        | Secrets Manager   | Terraform with remote state; destructive ops require approval workflow |

Rules:

- Redirect URIs and web origins are environment-specific variables, not hardcoded.
- Destructive operations (realm delete, user wipe) require explicit `TF_VAR_allow_destructive=true` or a separate workflow.
- Staging and production Terraform runs require remote state and manual or CI-gated approval.

---

### 5. Repository layout

```text
infra/
  README.md                     ? this decision's operational documentation
  bin/
    tf                          ? wrapper: tofu if available, else terraform

  modules/
    keycloak/                   ? Keycloak realm, clients, scopes, roles, users
      main.tf
      variables.tf
      outputs.tf
      README.md
    aws-network/                ? VPC, subnets, security groups
      main.tf
      variables.tf
      outputs.tf
    aws-database/               ? RDS, ElastiCache, parameter store
      main.tf
      variables.tf
      outputs.tf
    aws-observability/          ? CloudWatch, log groups, alert routing
      main.tf
      variables.tf
      outputs.tf
    ci-oidc/                    ? GitHub Actions OIDC trust, deployment roles
      main.tf
      variables.tf
      outputs.tf

  env/
    local/
      main.tf                   ? calls keycloak module, no cloud modules
      dev.tfvars.example
    development/
      main.tf
      development.tfvars.example
    test/
      main.tf
      test.tfvars.example
    staging/
      main.tf
      staging.tfvars.example
    production/
      main.tf
      production.tfvars.example

  .gitignore                    ? .terraform/, *.tfstate, *.auto.tfvars, etc.
```

---

### 6. Validation commands

```sh
# Syntax and format check (no cloud credentials required)
infra/bin/tf fmt -check -recursive infra/

# Init without backend (downloads providers, validates references)
infra/bin/tf -chdir=infra/env/dev init -backend=false

# Validate module structure
infra/bin/tf -chdir=infra/env/dev validate

# Plan with example vars (requires provider, not real credentials for Keycloak local)
infra/bin/tf -chdir=infra/env/dev plan -var-file=dev.tfvars.example
```

---

### 7. Keycloak-specific notes (deferred to ADR-ACT-0110)

The Keycloak Terraform module (`infra/modules/keycloak/`) will provision:

- Realm with configurable token lifetimes, login policy, and brute-force settings
- SPA client with PKCE-required redirect URIs and web origins (environment-specific)
- BFF/API client with client credentials grant if required
- Client scopes for OpenID Connect standard claims
- Protocol mappers for tenant-specific claims (organisationId, roles, permissions)
- All five roles from ADR-0021: `system-admin`, `tenant-admin`, `manager`, `member`, `viewer`
- Local/dev fixture test users (local and development environments only)

The Terraform Keycloak provider used is `mrparkers/keycloak` (most mature production-proven option).

---

## Rationale

Terraform/OpenTofu (Option C) is chosen because:

1. **Keycloak provider maturity** ? `mrparkers/keycloak` covers realm, client, scope, mapper, role, and user resources with production track records.
2. **Auditability** ? Every Keycloak configuration change is a reviewed pull request. No console steps outside version control.
3. **OpenTofu compatibility** ? HCL syntax is identical; `tofu` is a drop-in replacement. The `infra/bin/tf` wrapper preserves optionality.
4. **Plan/apply model** ? `terraform plan` shows exactly what will change before applying. Useful for security review of role/permission changes.
5. **State management** ? Remote state (S3 + DynamoDB lock) enables concurrent team workflows without conflicts.

## Consequences

**Positive:**

- Keycloak realm configuration is committed, reviewed, and reproducible.
- Every environment is provisionable from scratch without manual steps.
- Secrets are never in version control.
- Role/permission changes (ADR-0021) are reflected in Terraform and are PR-reviewable.

**Negative:**

- Terraform state management is an additional operational concern.
- Keycloak provider (`mrparkers/keycloak`) must be pinned and updated deliberately.
- Local Keycloak provisioning requires `terraform apply` before the first login attempt.

**Neutral / operational:**

- ADR-ACT-0008 may proceed using deterministic test session actors without live Keycloak.
- Real Keycloak login is blocked until ADR-ACT-0110 is Done.
- Cloud deployment is blocked until the relevant `infra/env/` modules exist.

## AI-assistance record

AI used: Yes

- Tool/model: Claude Sonnet 4.6
- Assistance scope: ADR drafting
- Human review status: Reviewed by architecture owner
- Evidence checked: `docs/evidence/infrastructure/declarative-provisioning-baseline.md`

## Validation / evidence

Evidence level: High

Evidence file: `docs/evidence/infrastructure/declarative-provisioning-baseline.md`

## Impacted areas

- Delivery: `infra/` layout established; `packages/tooling-terraform` confirms Terraform as a delivery package.
- Security: Secrets policy applied to all environments.
- Architecture: Terraform/OpenTofu vs Compose vs migrations ownership clearly separated.
- Identity: Keycloak realm configuration will move from manual to declarative (ADR-ACT-0110).
- CI/CD: OIDC trust and deployment roles are Terraform-owned.

## Follow-up actions

Follow-up actions tracked in `docs/adr/ACTION-REGISTER.md`.

## Review date

2026-08-28

## Related ADRs

- [ADR-0033](0033-define-environment-specific-domain-configuration.md) ? Extends the environment model with per-environment `kc_hostname`, `apex_domain`, and `.localhost` TLD conventions for local development.
- [ADR-0029](0029-define-multi-tenant-isolation-boundaries.md) ? Multi-tenant FQDN routing; the environment model determines the APEX_DOMAIN that all tenant FQDNs are subdomains of.
- [ADR-0027](0027-define-tilt-local-development-feedback-loop.md) ? Tilt dev mode sets `APEX_DOMAIN=dev.localhost` for auto-resolving multi-tenant dev.

## Supersedes

None.

## Superseded by

None.

## References

- ADR-0017: Docker Compose substrate (local runtime)
- ADR-0021: Identity model (roles to provision)
- ADR-0022: Auth/session/SSO boundary (Keycloak as adapter)
- `docs/evidence/infrastructure/declarative-provisioning-baseline.md`
- OpenTofu: <https://opentofu.org>
- Terraform Keycloak provider: <https://registry.terraform.io/providers/mrparkers/keycloak>
- OWASP Infrastructure as Code: <https://owasp.org/www-project-devsecops-guideline/>

## Notes

`infra/bin/tf` is the canonical command throughout Makefiles, CI pipelines, and documentation. It resolves to `tofu` if found on PATH, else `terraform`. This single wrapper preserves OpenTofu optionality without requiring two sets of instructions.

The `infra/env/dev/` configuration targets a locally-running Keycloak container (Compose identity profile, `localhost:8080`). It does not require cloud credentials. This enables developers to provision a deterministic local Keycloak realm without touching the cloud environment.

ADR-ACT-0008 (authenticated organisation profile slice) may proceed before ADR-ACT-0110 using pre-built `SessionActor` fixtures injected into the test/BFF layer. The slice must not claim real SSO login is complete.
