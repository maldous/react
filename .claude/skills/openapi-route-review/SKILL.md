---
name: openapi-route-review
description: Review new or changed BFF (platform-api) REST routes for OpenAPI alignment, error-envelope consistency, permission/resource metadata, tenant-scoping, strict DTO mapping, and drift coverage. Use when a platform-api route, handler, or the OpenAPI surface changes.
---

# OpenAPI / BFF route review

Review supplementary BFF REST routes against the OpenAPI baseline and the repo's route conventions.
GraphQL remains the primary client-facing boundary (ADR-0013); REST routes are supplementary (admin
control plane, health, readiness). Report only; make no broad product changes.

## Trigger conditions

- A new or changed route/handler/use-case under `apps/platform-api/**`.
- A change to `docs/api/openapi.json` or `docs/api/README.md`.
- A new admin/readiness/auth-settings endpoint.

## Files / dirs to inspect

- The changed route/handler/use-case and its contract DTOs (`packages/contracts-*`).
- `docs/api/openapi.json` (baseline) + `docs/api/README.md`.
- `tools/architecture/validate-openapi-drift/` (what drift checks).
- ADR-0013 (API boundary), ADR-0030/0036 (tenant admin), ADR-0040 (audit/verification).

## Checks

1. **OpenAPI alignment** — every new/changed REST route is reflected in `docs/api/openapi.json` (path, method, params, request/response schema).
2. **Error envelope** — failures use the typed `platform-errors` envelope consistently; no raw error strings or ad-hoc shapes.
3. **Permission + resource metadata** — route declares the required permission/resource; authorisation is server-side (tenant authority never in the SPA).
4. **Tenant-scoping** — tenant context derived server-side (path/host/session), not trusted from the client; global vs tenant-admin routes correctly separated.
5. **Strict DTOs** — explicit allowlisted request/response mapping; no pass-through of raw domain/adapter objects; no secret fields (pair with `auth-redaction-review` for auth routes).
6. **Drift coverage** — `openapi:drift` passes; new route is covered, not silently exempted.

## Commands to run / recommend

```bash
npm run openapi:drift
npm run test:platform-api        # targeted; not a full sweep
# optional style governance beyond drift (if Spectral is trialled):
npx @stoplight/spectral-cli lint docs/api/openapi.json
```

## Report template

```text
OpenAPI/BFF route review: PASS | ISSUES

Scope: <routes/files>
OpenAPI alignment: <each route present in openapi.json? Y/N>
Error envelope: <consistent typed envelope? Y/N>
Permission/resource metadata: <declared + server-side? Y/N>
Tenant-scoping: <server-derived? Y/N>
Strict DTOs: <ok / leaks or pass-through at ...>
openapi:drift: <PASS/FAIL>
```
