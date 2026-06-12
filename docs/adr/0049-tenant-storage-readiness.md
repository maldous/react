# ADR-0049: Tenant Storage Readiness + Isolation Proof

## Status

Accepted

## Date

2026-06-12

## Decision owner

Architecture owner / technical lead

## Consulted

ADR-0029 (multi-tenant isolation — S3 bucket policy + `{organisationId}/` key
prefix, §6), ADR-0031 (per-tenant resource provisioning — IAM user + prefix-scoped
bucket policy), ADR-0040 (audit trail), ADR-0045 (capability map), ADR-0048 (tenant
domains — sibling readiness slice). Reuses the existing `ObjectStoragePort`
(`@platform/storage-runtime`) and the prefix-per-tenant S3/MinIO adapter
(`@platform/adapters-object-storage`). Claude Opus 4.8 (implementation assistance,
human-reviewed).

## Context

The ADR-0045 capability map listed `storage` as **deferred**, even though the object
storage building blocks already existed: an `ObjectStoragePort` abstraction, an
`S3ObjectStorageAdapter` that locks every key operation to a `{organisationId}/`
prefix and rejects foreign keys (ADR-0029 §6 defence-in-depth), and an
`S3ProvisioningAdapter` that creates per-tenant IAM users with prefix-scoped bucket
policies (ADR-0031). What was missing was a _readiness_ signal: a way to check, per
tenant, whether storage is actually reachable and tenant-isolated — without faking it.

Constraints and risks:

- No storage credential may ever reach the SPA, logs, audit, or git.
- Readiness must be honest (ADR-0045): `configured` only after a real round-trip; in
  local dev where no S3 endpoint/credentials are wired, the truthful answer is
  `not_configured`.
- Probe objects must be temporary and cleaned up; no real customer object names.
- Reuse the existing port + adapter; do not build a new storage subsystem.

## Stakeholder concerns

- Product/Operations: a tenant admin (and `/admin/readiness`) can see whether storage
  is reachable and isolated, and trigger a probe.
- Security: tenant isolation is enforced at the adapter prefix guard (before IAM); no
  credential egress; the probe is audit-first.
- Data: single bucket, `{organisationId}/` prefix-per-tenant (ADR-0029 §6).

## Decision drivers

- Honesty of readiness over breadth (no file manager).
- Reuse of the proven port + prefix-isolation adapter.
- A real, repeatable probe (write → read → delete) + a deterministic isolation check.

## Options considered

### Option A: Readiness + operator-triggered probe over the existing port (chosen)

Add a `getTenantStorageReadiness` use case + `GET /api/org/storage/readiness` (runs a
live write/read/delete probe when configured) and an operator-triggered
`POST /api/org/storage/probe` (audit-first, returns the per-step result). Isolation is
asserted by confirming the prefix-locked adapter rejects a deliberately foreign key. A
minimal `/admin/storage` readiness panel surfaces it. Capability promoted to **partial**.

Pros: reuses proven plumbing; honest; bounded; real probe. Cons: a live probe does
object IO (bounded, self-cleaning).

### Option B: Full per-tenant storage management UI (browse/upload)

Pros: feature-rich. Cons: large; out of scope for a readiness pass; rejected.

### Option C: Promote the capability with a structural-only check (no probe)

Pros: trivial. Cons: cannot honestly claim "reachable"; rejected (a structural check
is used only for the cheap aggregate signal, with the deep probe on the dedicated
endpoint).

## Decision

Adopt **Option A**. Readiness statuses: `configured` (write/read/delete round-trip
succeeded AND a foreign cross-prefix key was rejected), `not_configured` (no S3
endpoint/credentials wired), `provider_unreachable` (round-trip failed),
`isolation_failed` (foreign key not rejected), `unknown`. `GET /api/org/storage/readiness`
and `POST /api/org/storage/probe` are gated by new `tenant.storage.read` /
`tenant.storage.write` permissions; the probe is audit-first; tenant authority + key
prefix derive from FQDN/session. The aggregate `GET /api/org/readiness` uses a cheap
configured-check (endpoint+credentials present) to avoid per-call object IO; the deep
probe is on the dedicated endpoint. The capability map promotes `storage` from
`deferred` to **partial**: the readiness probe + adapter-layer prefix isolation are
implemented; IAM-policy enforcement and provisioning are not exercised in this pass.

## Rationale

A single bucket with a `{organisationId}/` prefix is the established isolation model
(ADR-0029 §6); the adapter rejects any foreign key before a network call, so the
isolation guarantee is checkable deterministically. Readiness reports `configured`
only on a real round-trip, and `not_configured` (not a fake ready) when storage is not
wired — which is the truthful state in default local dev.

## Consequences

Positive: honest, testable storage readiness + isolation signal; no new subsystem; no
credential egress. Negative: the readiness GET performs bounded, self-cleaning object
IO when configured. Neutral: a `proof:tenant-storage` script proves the classifier,
an in-memory round-trip, and the adapter isolation guard, and probes live MinIO when
S3 env is wired (else honest SKIP).

## AI-assistance record

AI used: Yes. Tool/model: Claude Opus 4.8 (1M context), Claude Code. Scope:
implementation, tests, runtime proof, this ADR. Human review: required before merge.

## Validation / evidence

Evidence level: High. Evidence: `docs/evidence/operations/tenant-storage-readiness.md`.

## Impacted areas

- Architecture: new readiness/probe use case + `/api/org/storage/*` routes; reuses the
  existing `ObjectStoragePort` + `S3ObjectStorageAdapter`.
- Data: no schema change; uses the tenant `{organisationId}/` key prefix.
- API: `GET /api/org/storage/readiness`, `POST /api/org/storage/probe`.
- Security: prefix-isolation enforced; audit-first probe; no credential egress.
- Testing: backend unit (classifier + probe + isolation) + frontend MSW/axe + OpenAPI
  drift + runtime proof (in-memory round-trip + adapter isolation guard; live MinIO opt-in).
- UX: minimal `/admin/storage` readiness panel + nav + readiness link.
- Documentation: capability map, OpenAPI, i18n, CODEMAPS, ACTION-REGISTER.

## Follow-up actions

Tracked in:

```text
docs/adr/ACTION-REGISTER.md
```

ADR-ACT-0218 covers this slice. Future actions: a live IAM-policy enforcement proof,
per-tenant usage/quota readiness, and provisioning verification.

## Review date

2026-12-12

## Supersedes

None.

## Superseded by

None.

## References

- ADR-0029 multi-tenant isolation (S3 prefix + bucket policy, §6)
- ADR-0031 per-tenant resource provisioning (IAM user + bucket policy)
- ADR-0045 enterprise capability map
- ADR-0048 tenant custom domains (sibling readiness slice)

## Notes

Readiness statuses: `configured`, `not_configured`, `provider_unreachable`,
`isolation_failed`, `unknown`. Isolation model: single bucket, `{organisationId}/`
key prefix (ADR-0029 §6); the adapter rejects foreign keys before any network call.
The probe object is temporary and self-cleaning; no credential is ever returned.
