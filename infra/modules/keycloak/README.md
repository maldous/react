# Module: keycloak

Provisions the Keycloak identity substrate for the platform.

Governed by [ADR-0023](../../../docs/adr/0023-define-declarative-infrastructure-provisioning-model.md),
[ADR-0021](../../../docs/adr/0021-define-identity-tenancy-roles-and-permissions-model.md), and
[ADR-0022](../../../docs/adr/0022-define-authentication-session-and-sso-integration-boundary.md).
Implemented in ADR-ACT-0110.

## Provider

`mrparkers/keycloak ~> 4.4` ? see `infra/env/local/versions.tf`.

## What this module provisions

| Resource                                         | Description                                                              |
| ------------------------------------------------ | ------------------------------------------------------------------------ |
| `keycloak_realm`                                 | Platform realm with token lifetimes and login policy                     |
| `keycloak_openid_client.spa`                     | `platform-spa` ? public, PKCE, React SPA client                          |
| `keycloak_openid_client.bff`                     | `platform-api` ? confidential, PKCE, BFF/API client (ADR-0022)           |
| `keycloak_openid_client_scope.platform_claims`   | Optional scope for organisationId claim                                  |
| `keycloak_openid_user_attribute_protocol_mapper` | Maps `organisationId` user attribute ? JWT claim                         |
| `keycloak_role` ? 5                              | `system-admin`, `tenant-admin`, `manager`, `member`, `viewer` (ADR-0021) |
| `keycloak_user` ? 3                              | Fixture users (local/dev only, gated by `provision_fixture_users`)       |
| `keycloak_user_roles` ? 2                        | Role assignments for admin (tenant-admin) and viewer fixture users       |

## What this module does NOT manage

- Database schema ? owned by application migrations (`apps/platform-api/src/db/`)
- Application fixture data ? owned by seed scripts (`apps/platform-api/src/db/seed.ts`)
- Production users ? never provisioned here
- Cloud infrastructure (AWS, CloudFlare) ? separate modules

## Inputs

| Variable                  | Type                 | Description                                  |
| ------------------------- | -------------------- | -------------------------------------------- |
| `keycloak_url`            | `string`             | Keycloak base URL                            |
| `realm_name`              | `string`             | Realm name (default: `platform`)             |
| `realm_display_name`      | `string`             | Realm display name                           |
| `spa_client_id`           | `string`             | SPA client ID (default: `platform-spa`)      |
| `spa_redirect_uris`       | `list(string)`       | SPA allowed redirect URIs                    |
| `spa_web_origins`         | `list(string)`       | SPA CORS origins                             |
| `bff_client_id`           | `string`             | BFF client ID (default: `platform-api`)      |
| `bff_client_secret`       | `string` (sensitive) | BFF client secret                            |
| `bff_redirect_uris`       | `list(string)`       | BFF allowed redirect URIs                    |
| `provision_fixture_users` | `bool`               | Create fixture test users (default: `false`) |
| `fixture_user_password`   | `string` (sensitive) | Fixture user password                        |

## Outputs

| Output                       | Description                  |
| ---------------------------- | ---------------------------- |
| `realm_id`                   | Realm Terraform ID           |
| `realm_name`                 | Realm name                   |
| `spa_client_id`              | SPA client ID                |
| `bff_client_id`              | BFF client ID                |
| `platform_claims_scope_name` | `platform-claims` scope name |

## Fixture users

| Email                     | Role           | `organisationId` attr | Created when                     |
| ------------------------- | -------------- | --------------------- | -------------------------------- |
| `admin@fixture.local`     | `tenant-admin` | fixture org UUID      | `provision_fixture_users = true` |
| `viewer@fixture.local`    | `viewer`       | fixture org UUID      | `provision_fixture_users = true` |
| `forbidden@fixture.local` | (none)         | (none)                | `provision_fixture_users = true` |

Fixture user emails match `apps/platform-api/src/db/seed.ts` exactly.

## Usage

See `infra/env/local/` for the local environment wiring.

```sh
# Requires Keycloak running:
docker compose --profile identity up -d keycloak

make keycloak-plan-local
# Review, then:
infra/bin/tf -chdir=infra/env/local apply -var-file=local.tfvars
```
