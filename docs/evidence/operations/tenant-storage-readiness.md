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

**Update (ADR-ACT-0223):** the live MinIO probe now runs **by default** in local dev.
The proof loads `.env`/`.env.dev`, resolves S3 config from `S3_*` → `MINIO_*` →
local defaults, ensures the bucket deterministically (`HeadBucket`/`CreateBucket`,
idempotent), then writes → reads-back (size-verified) → deletes a probe object and
rejects a foreign key. It SKIPs only when MinIO is genuinely unreachable. The readiness
*route* is also live locally: `getProvisioningConfig` falls back to `MINIO_*`.

Executed output (dev profile, MinIO @ `http://localhost:9000`, 2026-06-12):

```text
# Tenant storage runtime proof

PASS  round-trip + isolation → configured
PASS  round-trip without isolation → isolation_failed
PASS  in-memory probe write/read/delete + isolation → configured
PASS  prefix-locked adapter rejects a foreign cross-prefix key (ADR-0029 §6)
PASS  live MinIO reachable + bucket ready @ http://localhost:9000 (platform-data)
PASS  live probe wrote the probe object
PASS  live probe read it back (size-verified)
PASS  live probe deleted it (self-cleaning)
PASS  live probe rejected a foreign cross-prefix key
PASS  live MinIO probe → configured
INFO  IAM/bucket-policy isolation is NOT proven here — MinIO's admin API differs from AWS IAM; …

# ALL CHECKS PASSED
```

## Proven live vs unit/MSW only

- **Live-proven (against MinIO @ localhost:9000):** deterministic bucket provisioning,
  and the full write → read-back (size-verified) → delete probe round-trip under the
  tenant prefix, plus foreign-key rejection.
- Live-proven (no network needed): the `S3ObjectStorageAdapter` prefix guard rejects a
  foreign cross-prefix key (ADR-0029 §6).
- Unit-proven (`node:test`): the classifier (all branches) and probe round-trip / failure
  / isolation semantics against the in-memory port.
- MSW-proven (frontend): the `/admin/storage` readiness/probe/read-only flows + axe.
- NOT proven (honestly deferred): **IAM / bucket-policy enforcement** of the tenant
  prefix. The adapter prefix guard is defence-in-depth at the app layer; the S3/MinIO
  *server-side* policy (per-tenant IAM user + prefix-scoped bucket policy, ADR-0031) is
  not automated locally because MinIO's admin/policy API is not AWS-IAM-compatible
  (`@aws-sdk/client-iam` against MinIO is unreliable). Exact next step below.

## Capability map changes

`storage`: `deferred` → **partial**, `adminRoute: /admin/storage`,
`requiredPermission: tenant.storage.read`, `readinessKind: "tenant-storage"` (new
`storageReadiness` signal in `/api/org/readiness`, a cheap configured-check). Optional →
never blocks overall readiness.

## Known deferrals

- **IAM / bucket-policy enforcement (server-side isolation).** Exact next step: provision
  a per-tenant MinIO policy via the MinIO Admin API (`mc admin policy` or the
  `madmin`-compatible endpoint), attach it to a per-tenant access key, then prove a key
  scoped to `{orgA}/` is *denied* a `GET {orgB}/…` at the storage server (not just the
  adapter). Blocked on MinIO-admin tooling (not `@aws-sdk/client-iam`); the AWS-IAM path
  (`S3ProvisioningAdapter`) is for real AWS/prod.
- Per-tenant usage/quota readiness.
- (Closed by ADR-ACT-0223: live MinIO probe now runs by default in local dev.)

## No-secret guarantee

No storage credential is returned, logged, or audited. The readiness/probe responses
carry only the key prefix, configured/isolation booleans, and per-step outcomes.

## No-fake-readiness guarantee

`configured` requires a real round-trip AND a rejected foreign key; an unwired platform
is `not_configured`, never ready. Asserted by `tenant-storage.test.ts` and
`capability-registry.test.ts`.

## ACTION-REGISTER linkage

ADR-ACT-0218 (Source ADR-0049). Evidence: this file.
