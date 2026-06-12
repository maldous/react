# Tenant Storage Readiness + Isolation Proof — Evidence (ADR-0049 / ADR-ACT-0218)

Date: 2026-06-12. Owner: Architecture owner / technical lead.
AI assistance: Claude Opus 4.8 (implementation), human-reviewed.

## Scope delivered

A readiness + isolation-proof layer over the existing object-storage plumbing
(`@platform/storage-runtime` `ObjectStoragePort` + `@platform/adapters-object-storage`
prefix-per-tenant S3/MinIO adapter; ADR-0029 §6 / ADR-0031):

- **Contracts** (`@platform/contracts-admin`, strict/no-passthrough):
  `TenantStorageReadinessResponse` (status, prefix, endpointConfigured,
  isolationEnforced) + `TenantStorageProbeResult` (status, wrote, read, deleted,
  foreignKeyRejected). No credential field exists.
- **Use case** (`usecases/tenant-storage.ts`): pure `classifyStorageProbe` +
  `tenantStoragePrefix`, a live `probeTenantStorage` (write → read-back size-verified →
  delete + foreign-key isolation assertion), and `getTenantStorageReadiness`.
- **API**: `GET /api/org/storage/readiness` (runs a live probe when configured) and
  `POST /api/org/storage/probe` (operator-triggered, audit-first), tenant-scoped
  (FQDN/session). The aggregate `GET /api/org/readiness` uses a cheap configured-check
  (no object IO) for its storage signal; the deep probe is on the dedicated endpoint.
- **Permissions**: new `tenant.storage.read` / `tenant.storage.write` on `tenant-admin`.
- **UI**: a minimal `/admin/storage` readiness panel (status, tenant prefix, isolation
  state, operator probe button) + nav + `/admin/readiness` link. NOT a file browser.

## Decisions

- Isolation model: single bucket, `{organisationId}/` key prefix (ADR-0029 §6); the
  adapter rejects any foreign key *before* a network call (defence-in-depth before IAM).
- Readiness is `configured` only after a real write/read/delete round-trip AND a
  rejected foreign key; `not_configured` when no S3 endpoint/credentials are wired
  (the truthful default-local-dev state); `provider_unreachable` / `isolation_failed`
  classify real failures. Never faked.
- Probe objects live under `{prefix}.readiness-probe/<uuid>` and are deleted; no real
  object names; no credential is returned, logged, or audited (probe metadata records
  only `operation` + `endpointConfigured`).

## Tests run (with proof layer)

- `node:test` (platform-api) — `tenant-storage.test.ts` (23 across suites):
  `classifyStorageProbe` (configured/isolation_failed/provider_unreachable branches),
  `tenantStoragePrefix`, `probeTenantStorage` (round-trip → configured + self-cleaning;
  isolation_failed when foreign key not rejected; provider_unreachable on write throw;
  thrown isolation assertion treated as rejection), `getTenantStorageReadiness`
  (not_configured when unwired; live probe when configured).
- `node:test` — `capability-registry.test.ts`: `storage` is `partial`, its readiness
  reflects the new `storageReadiness` signal honestly, optional (non-blocking); the
  never-fake-readiness guard still pins the deferred set.
- Vitest (frontend) — `AdminStoragePage.test.tsx` (4, MSW-proven): readiness banner +
  prefix + isolation render, run-probe announces, read-only hides the probe button, axe.
- OpenAPI drift: 80 routes match `docs/api/openapi.json` (2 new paths).

## Runtime proof (executed)

`apps/platform-api/scripts/tenant-storage-runtime-proof.ts`
(`npm run proof:tenant-storage`).

Executed output (dev profile, 2026-06-12; S3 admin env not wired locally):

```text
# Tenant storage runtime proof

PASS  round-trip + isolation → configured
PASS  round-trip without isolation → isolation_failed
PASS  in-memory probe write/read/delete + isolation → configured
PASS  prefix-locked adapter rejects a foreign cross-prefix key (ADR-0029 §6)
SKIP  live MinIO probe — S3 not wired (readiness is honestly not_configured; set S3_DEFAULT_ENDPOINT + S3_ADMIN_* to exercise)

# ALL CHECKS PASSED
```

## Proven live vs unit/MSW only

- Live-proven (no network needed): the `S3ObjectStorageAdapter` prefix guard rejects a
  foreign cross-prefix key (ADR-0029 §6) — deterministic, always run.
- Unit-proven (`node:test`): the classifier (all branches) and the probe round-trip /
  failure / isolation semantics against the in-memory port.
- MSW-proven (frontend): the `/admin/storage` readiness/probe/read-only flows + axe.
- NOT proven (honestly deferred): a live MinIO round-trip in default local dev (S3 env
  not wired → SKIP), IAM-policy enforcement, and provisioning. Set the S3 env
  (`S3_DEFAULT_ENDPOINT`, `S3_ADMIN_ACCESS_KEY_ID`, `S3_ADMIN_SECRET_ACCESS_KEY`) to
  exercise the live probe.

## Capability map changes

`storage`: `deferred` → **partial**, `adminRoute: /admin/storage`,
`requiredPermission: tenant.storage.read`, `readinessKind: "tenant-storage"` (new
`storageReadiness` signal in `/api/org/readiness`, a cheap configured-check). Optional →
never blocks overall readiness.

## Known deferrals

- A live IAM-policy enforcement proof (the adapter prefix guard is proven; the
  S3/MinIO bucket-policy + per-tenant IAM enforcement is not exercised here).
- Per-tenant usage/quota readiness and provisioning verification.
- A live MinIO probe in default local dev (S3 env not wired).

## No-secret guarantee

No storage credential is returned, logged, or audited. The readiness/probe responses
carry only the key prefix, configured/isolation booleans, and per-step outcomes.

## No-fake-readiness guarantee

`configured` requires a real round-trip AND a rejected foreign key; an unwired platform
is `not_configured`, never ready. Asserted by `tenant-storage.test.ts` and
`capability-registry.test.ts`.

## ACTION-REGISTER linkage

ADR-ACT-0218 (Source ADR-0049). Evidence: this file.
