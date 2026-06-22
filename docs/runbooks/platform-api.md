# Platform API Route Alerts

## Admin API Route Alerts

Owner: platform-operations
Routing: platform-oncall

Page when any `/api/admin/*` route breaches the platform API 5xx/error-rate or latency SLO. Triage the route label, request id, tenant id when present, and correlated trace before restarting dependencies. Confirm Keycloak, Postgres, Redis, Loki, and provider readiness before declaring recovery.

## Tenant API Route Alerts

Owner: tenant-platform-operations
Routing: tenant-platform-oncall

Page when any tenant-scoped `/api/org/*`, `/api/me/*`, or `/api/organisation/*` route breaches the platform API 5xx/error-rate or latency SLO. Triage the tenant FQDN, organisation id, route label, request id, and correlated trace. Check tenant schema availability, quota state, provider readiness, and recent tenant-scoped mutations.

## Auth API Route Alerts

Owner: identity-operations
Routing: identity-oncall

Page when `/api/auth/*` routes breach the platform API 5xx/error-rate or latency SLO. Triage tenant discovery, stored auth-provider settings, Keycloak realm availability, OIDC discovery, and credential readiness. Do not expose provider secrets in incident notes.

## GraphQL Route Alerts

Owner: api-platform-operations
Routing: api-platform-oncall

Page when `/api/graphql` breaches the platform API 5xx/error-rate or latency SLO. Triage operation name, field guard decisions, tenant FQDN, request id, audit event emission, and correlated trace. Confirm per-operation authorization before retrying a failed mutation.

## Public API Route Alerts

Owner: edge-platform-operations
Routing: edge-platform-oncall

Page when public API or internal edge handshake routes breach the platform API 5xx/error-rate or latency SLO. Triage host resolution, Caddy forwarding, cookie/session availability, request id, and correlated trace. Public routes must not require a user session, but failures still need tenant and edge routing evidence where available.
