# Evidence: ADR-ACT-0110 — Keycloak Terraform/OpenTofu Provisioning Baseline

**Date:** 2026-05-29
**Status:** Done
**Action:** ADR-ACT-0110
**ADR Refs:** ADR-0021, ADR-0022, ADR-0023

## Summary

Implements declarative Keycloak identity provisioning for the local environment using
`mrparkers/keycloak v4.4.0`. The module provisions the realm, clients, scopes, claim
mappers, ADR-0021 roles, and fixture test users. `terraform validate` passes offline.
`terraform plan` against live local Keycloak produces 15 resources, 0 errors.

## Provider

| Field | Value |
| --- | --- |
| Provider | `mrparkers/keycloak` |
| Version constraint | `~> 4.4` |
| Version resolved | `4.4.0` |
| Keycloak version tested | `26.2.5` (Compose identity profile) |
| Lock file | `infra/env/local/.terraform.lock.hcl` |

## Realm

| Field | Value |
| --- | --- |
| Realm name | `platform` (local: `platform`) |
| Display name | `Enterprise Platform (local)` |
| Registration | Disabled |
| Email login | Enabled |
| Verify email | Disabled (local dev) |
| Access token lifespan | 15 minutes |
| SSO idle | 30 minutes |
| SSO max | 10 hours |

## Clients

### SPA client — `platform-spa`

| Field | Value |
| --- | --- |
| Access type | `PUBLIC` (no client secret) |
| PKCE | `S256` |
| Standard flow | Enabled |
| Implicit / direct grants | Disabled |
| Redirect URIs (local) | `http://localhost:5173/*`, `http://localhost:5173/auth/callback` |
| Web origins (local) | `http://localhost:5173` |
| Note | Provisioned for future direct-SPA flows. Current ADR-ACT-0008 slice uses fixture sessions; this client is not yet used at runtime. |

### BFF/API client — `platform-api`

| Field | Value |
| --- | --- |
| Access type | `CONFIDENTIAL` |
| PKCE | `S256` |
| Standard flow | Enabled |
| Service accounts | Disabled |
| Redirect URIs (local) | `http://localhost:3001/auth/callback`, `http://localhost:3001/*` |
| Web origins | `[]` (servers don't need CORS origins) |
| Client secret | Variable `bff_client_secret` — stored in `.tfvars` (gitignored); placeholder in `.tfvars.example` |
| Note | The BFF handles the full OAuth callback flow per ADR-0022. |

## Client scopes

| Scope | Type | Mapper |
| --- | --- | --- |
| `platform-claims` | Optional | `keycloak_openid_user_attribute_protocol_mapper`: maps `organisationId` user attribute → `organisationId` JWT claim (id_token, access_token, userinfo) |

The scope is created as optional (not default) to avoid replacing built-in scopes. Clients
request it explicitly via the `scope` parameter.

## Realm roles (ADR-0021)

| Role | Type | Semantics |
| --- | --- | --- |
| `system-admin` | Global | Full access across all tenants. Not assignable via product UI. |
| `tenant-admin` | Tenant-scoped | Full control within the organisation. |
| `manager` | Tenant-scoped | Manages members below their level. |
| `member` | Tenant-scoped | Standard access to product features. |
| `viewer` | Tenant-scoped | Read-only access. |

## Redirect URIs and web origins (local)

| Environment | SPA redirect | BFF redirect | SPA web origin | BFF web origin |
| --- | --- | --- | --- | --- |
| `local` | `http://localhost:5173/*` | `http://localhost:3001/auth/callback` | `http://localhost:5173` | `[]` |

## Fixture users policy

- Enabled by `provision_fixture_users = true` (local/development only)
- Default for module: `false` (prevents accidental staging/production creation)
- Fixture user emails match `apps/platform-api/src/db/seed.ts` exactly

| Username | Role assignment | `organisationId` attribute |
| --- | --- | --- |
| `admin@fixture.local` | `tenant-admin` | `00000000-0000-0000-0000-000000000001` |
| `viewer@fixture.local` | `viewer` | `00000000-0000-0000-0000-000000000001` |
| `forbidden@fixture.local` | (none) | (none) — no-membership actor |

Fixture user passwords are stored in `local.tfvars` (gitignored). The `.tfvars.example`
contains a placeholder (`password`) that documents the pattern without committing a secret.

## Secrets policy

- No secrets committed to source control
- `.tfvars` files are gitignored (see `infra/.gitignore`)
- `.tfvars.example` files contain placeholder values only
- BFF client secret: variable with no default; value in gitignored `.tfvars`
- Fixture user password: variable with empty string default; overridden in `.tfvars`

## Commands run

```sh
# Format check
infra/bin/tf fmt -check -recursive infra/
# → EXIT 0: format clean

# Init (downloads mrparkers/keycloak v4.4.0, generates lock file)
infra/bin/tf -chdir=infra/env/local init -backend=false -input=false
# → Terraform has been successfully initialized!

# Validate (offline — no Keycloak required)
infra/bin/tf -chdir=infra/env/local validate
# → Success! The configuration is valid.

# Plan (requires local Keycloak on http://localhost:8080)
# In this test run, Keycloak was on http://localhost:8090 (port 8080 occupied)
infra/bin/tf -chdir=infra/env/local plan \
  -var-file=local.tfvars.example \
  -var="keycloak_url=http://localhost:8090" \
  -input=false
# → Plan: 15 to add, 0 to change, 0 to destroy.
```

## Plan result

```text
Plan: 15 to add, 0 to change, 0 to destroy.

Resources planned:
  module.keycloak.keycloak_realm.platform
  module.keycloak.keycloak_role.system_admin
  module.keycloak.keycloak_role.tenant_admin
  module.keycloak.keycloak_role.manager
  module.keycloak.keycloak_role.member
  module.keycloak.keycloak_role.viewer
  module.keycloak.keycloak_openid_client.spa
  module.keycloak.keycloak_openid_client.bff
  module.keycloak.keycloak_openid_client_scope.platform_claims
  module.keycloak.keycloak_openid_user_attribute_protocol_mapper.organisation_id
  module.keycloak.keycloak_user.admin[0]
  module.keycloak.keycloak_user.viewer[0]
  module.keycloak.keycloak_user.forbidden[0]
  module.keycloak.keycloak_user_roles.admin_roles[0]
  module.keycloak.keycloak_user_roles.viewer_roles[0]

Outputs:
  bff_client_id = "platform-api"
  realm_name    = "platform"
  spa_client_id = "platform-spa"
```

## Makefile targets

| Target | Description |
| --- | --- |
| `make infra-check` | fmt-check + init + validate (offline, no Keycloak needed) |
| `make keycloak-plan-local` | init + validate + plan (requires Keycloak on localhost:8080) |

## Known deferrals

| Deferral | Blocked by |
| --- | --- |
| Real browser login flow (OAuth callback wired through platform-api) | ADR-ACT-0119 |
| Cloud/staging/production identity environments | Tier 3/4 work; blocked until AWS infra exists |
| Secrets management in staging/production (Secrets Manager) | Pre-production work |
| `apply` automation in CI (non-local) | CI OIDC module (ADR-ACT-TBD) |

## Confirmation

- Real browser login flow is **NOT** claimed complete. ADR-ACT-0008 continues to use
  fixture sessions via `LOCAL_FIXTURE_SESSION` env var.
- ADR-ACT-0110 adds the declarative identity substrate; it does not wire the login flow.
- ADR-ACT-0119 is opened to track real login flow wiring.
- ADR-ACT-0008 remains accepted. `make pre-slice-gate` still passes.
