# ADR-0073: Composed-service SSO via Keycloak OIDC

## Status

Accepted

## Date

2026-06-14

## Decision owner

Architecture owner / platform

## Consulted

ADR-0022 (BFF OAuth), ADR-0030 (admin-tool OIDC clients), ADR-0033 (hostnames/issuer),
ADR-0069/0070 (secrets / provider config), ADR-0072 (environment substrate),
ADR-ACT-0233 (click-through policy).

## Context

The composed Compose GUI services (Grafana, SonarQube, MinIO, pgAdmin, …) had
independent local logins (or default admin credentials). Operators clicking through
from the platform — see the `/admin/clickthrough` page (ADR-ACT-0233 / ADR-0072) —
had to authenticate separately to each, and SonarQube forced a password change
(resolved in ADR-0072). The goal: every SSO-capable composed service authenticates
via the platform Keycloak realm (the same login as the app), with platform roles
mapped to service roles, and credentials managed centrally (generated env / OpenBao),
never hand-edited.

## Decision (delivered)

1. **Keycloak OIDC clients for the SSO-capable services.** The Keycloak module gains
   confidential clients for Grafana + SonarQube (MinIO + pgAdmin already exist as
   public PKCE clients, ADR-0030), plus a realm-role token mapper on each (claim
   `roles`, in the ID token + userinfo) so services receive the user's platform roles
   for authorisation mapping. All gated by `enable_composed_sso` (default false) so
   default provisioning — and staging/prod — are unchanged until explicitly enabled.
   `make infra-check` (terraform validate) covers this statically.

2. **Confidential client secrets in the generated env.** `GRAFANA_OIDC_CLIENT_SECRET`
   and `SONAR_OIDC_CLIENT_SECRET` are per-environment derived secrets in the generated
   runtime env (ADR-0072); `keycloak-provision` exports them as `TF_VAR_*` so the
   Keycloak client and the service share one value. MinIO + pgAdmin are public PKCE
   (no secret).

3. **Service-side OIDC config, opt-in via `COMPOSE_SSO_ENABLED` (default false).**
   - **Grafana** — `GF_AUTH_GENERIC_OAUTH_*` wired in compose: auth URL browser-facing
     (`KC_HOSTNAME`), token/userinfo backchannel (`KEYCLOAK_URL`); role map
     `system-admin→Admin, tenant-admin→Editor, else Viewer`.
   - **MinIO** — `MINIO_IDENTITY_OPENID_*` already wired (ADR-0030); the realm-role
     mapper makes role→policy mapping possible.
     The toggle keeps SSO off by default so the local stack is unchanged until an
     operator turns it on AND provisions the clients (`enable_composed_sso=true`).

4. **Per-service SSO capability matrix** (`docs/evidence/platform/composed-service-sso-matrix.md`)
   records what each service supports and its exact wiring.

### Alternatives considered

### Rejected alternatives (required)

- **A separate IdP / per-service local logins** — rejected: the platform Keycloak realm
  is the single source of identity; SSO unifies login + role mapping.
- **Enabling SSO unconditionally** — rejected: it would break the default local stack
  (clients not provisioned) and staging/prod; gated opt-in (`COMPOSE_SSO_ENABLED` +
  `enable_composed_sso`) is the safe default.
- **Committing SSO as "proven" without a live click-through** — rejected: live OIDC
  flows are an explicit proof requirement on a running stack; this ADR ships the
  statically-validated wiring and records live proof as the acceptance step.
- **Claiming OIDC for services that do not support it** — rejected: the matrix is honest
  (Mailpit/ClickHouse/WireMock/LocalStack/Tilt have no SSO; Sentry self-hosted SSO is a
  business feature; SonarQube community needs the sonar-auth-oidc plugin).

### Accepted decision

Points 1–4 above.

## Implementation phases

1. Keycloak clients + role mappers + module vars (delivered; infra-check green).
2. Generated-env client secrets + `COMPOSE_SSO_ENABLED` + `keycloak-provision` exports
   (delivered).
3. Grafana service OIDC config (delivered); MinIO already wired (ADR-0030).
4. pgAdmin OAuth2 service config (config file) + SonarQube `sonar-auth-oidc` plugin +
   props — client-ready; service-side config documented in the matrix as the remaining
   per-service step.

## Acceptance criteria

- `make infra-check` green with the SSO clients (statically validated).
- Default provisioning + local stack unchanged when SSO is off.
- With `COMPOSE_SSO_ENABLED=true` + `enable_composed_sso=true` provisioned, an operator
  signs into Grafana (and MinIO) via the platform Keycloak login and lands with the
  mapped role — verified by a live click-through on a running stack.

## Proof requirements

Live, on a running stack (deferred — cannot be browser-verified in the sandbox):
a click-through from `/admin/clickthrough` to Grafana/MinIO completes the Keycloak
OIDC flow and the session carries the mapped role. Static: `make infra-check`,
`npm run compose:config:all`, `make env-validate-all`.

## Production blockers

- Real (non-local) deployment must use HTTPS issuer URLs + per-env redirect URIs and
  real client secrets seeded via OpenBao (not local-bootstrap derived).
- SonarQube OIDC requires bundling the `sonar-auth-oidc` plugin into the image/volume.

## Consequences

- One login (the platform Keycloak realm) for the app + composed services, role-mapped.
- Credentials centrally managed (generated env / OpenBao); no hand-edited service creds.
- SSO is opt-in, so the change is inert until explicitly enabled + provisioned.

## Validation / evidence

`docs/evidence/platform/composed-service-sso-matrix.md`.

## Follow-up actions

See ADR-ACT-0275. Not delivered: pgAdmin OAuth2 service config file; SonarQube plugin
install; live per-service OIDC click-through proof; staging/prod env wiring of the SSO
vars (dev is the validated reference).

## References

ADR-0022, ADR-0030, ADR-0033, ADR-0069, ADR-0070, ADR-0072, ADR-ACT-0233.

## Notes

The realm-role claim is named `roles`; the Grafana `role_attribute_path` and MinIO
claim mapping read it. The platform roles are the ADR-0021 realm roles (system-admin,
tenant-admin, manager, member, viewer).
