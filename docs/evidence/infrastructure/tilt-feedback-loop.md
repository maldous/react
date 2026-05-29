# Evidence: ADR-ACT-0127 — Tilt fast-dev mode

**Date:** 2026-05-29
**Status:** Done (fast-dev mode)
**Action:** ADR-ACT-0127
**ADR Ref:** ADR-0027

## Tiltfile summary

Implemented at repo root. Resources:

| Resource | Mode | Label |
| -------- | ---- | ----- |
| postgres, redis, clickhouse, minio, mailpit, otel-collector | Compose (auto) | infra |
| identity-profile | local_resource (manual) | auth |
| platform-api | local_resource serve_cmd (auto) | app |
| react-app | local_resource serve_cmd (auto) | app |
| typecheck | local_resource (auto) | quality |
| lint | local_resource (auto) | quality |
| platform-api-tests | local_resource (auto) | tests |
| react-tests | local_resource (auto) | tests |
| architecture-check | local_resource (manual) | quality |
| make-check | local_resource (manual) | quality |
| e2e-dev | local_resource (manual) | tests |
| i18n-validation | local_resource (auto, report-only) | quality |
| prod-build-and-test | local_resource (manual) | tests |
| aldous-smoke | local_resource (manual) | tests |

## ADR-0027 acceptance criteria checklist

- [x] Location: repo root as Tiltfile
- [x] docker_compose() for compose.yaml
- [x] local_resource() for host commands
- [x] Labels for resource grouping
- [x] resource_deps for startup ordering
- [x] Links: React app, API health/readiness, Mailpit
- [x] Readiness probes on platform-api and react-app
- [x] Trigger modes: auto for fast, manual for slow
- [x] No secrets in Tiltfile
- [x] No committed reports/traces/screenshots

## Deferrals

- **Production parity (ADR-ACT-0128 — In Progress):** prod-build-and-test runs `npm run test:e2e:prod` (vite build + Playwright preview); aldous-smoke tests live aldous.info. Full Compose web-profile container wiring (platform-api container + Caddy) is deferred.
- **Production parity (ADR-ACT-0128 — In Progress):** prod-build-and-test runs `npm run test:e2e:prod` (vite build + Playwright preview); aldous-smoke tests live aldous.info. Compose web-profile container resources are now represented as manual Tilt resources (`platform-api-web`, `react-app-web`), with the identity profile exposed as `identity-profile`.
- **i18n-validation (ADR-ACT-0129 — In Progress):** auto-trigger resource added and now depends on the React/API app resources so it reflects the affected surface set.
- Keycloak link: intentionally only available after `make compose-up-identity` via `identity-profile`.
