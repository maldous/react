# Secrets foundation — central secret store + OpenBao (Tier-1 kernel)

**ADR:** ADR-0069 · **Action:** ADR-ACT-0265 · **Status:** Delivered + locally proven
**Capability:** `runtime-secrets` (compute-runtime / foundation kernel)

## Scope delivered

A central, audited, tenant-scoped runtime secret store behind a new
`SecretStorePort`, with **two interchangeable backends — both live-proven**:

1. **Built-in `PostgresSecretStore` (durable default).** `secret_refs` (migration
   031, RLS), value AES-256-GCM encrypted at rest (ADR-0047 `tenant-secret-crypto`).
2. **Composed `OpenBaoSecretStore` (open-source, Vault-compatible).** The value
   lives in OpenBao KV v2; only value-free metadata + the backend path is mirrored
   in `secret_refs` (`encrypted_value` NULL). Talks to OpenBao over the global
   `fetch` — **no new npm dependency**.

A caller stores a secret by logical name and receives an **opaque `secret:<uuid>`
reference**. The plaintext value is **never** returned by any metadata/list/
readiness path; `resolve()` is the only value-returning method and is
**server-internal** — never wired to an HTTP response.

## Design

| Concern | Decision |
| --- | --- |
| Handle | opaque `secret:<uuid>` ref; the value is never echoed back |
| Default backend | built-in Postgres (`encrypted_value`, AES-256-GCM at rest) |
| Composed backend | OpenBao KV v2 (`SECRET_STORE_PROVIDER=openbao` + `OPENBAO_ADDR`/`OPENBAO_TOKEN`) |
| Selection | `selectSecretStore` in `routes.ts` — built-in unless OpenBao is configured |
| Lifecycle | create/rotate (bumps `version`), revoke (soft-disable), hard delete |
| Audit | `secret_ref.created/revoked/deleted` (audit-before-change) — name/ref only, never the value |
| Tenant isolation | `secret_refs` organisation-scoped (RLS); OpenBao path `<base>/<org>/<ref>` |
| Readiness | Postgres ping / OpenBao sys/health; OpenBao down means degraded, resolve() returns null, put() throws (never faked, never silently substituted) |
| Surface | operator-only GET/POST /api/admin/secrets, POST .../revoke + .../delete, GET .../readiness (platform.secrets.*) |
| Dependency | none added — OpenBao is reached with `fetch` |

## Environment classification

OpenBao is **per-environment** (secrets are environment-specific runtime state;
per-env path isolation). It is profile-gated (`secrets`, `make compose-up-secrets`)
and runs in **`-dev` mode locally** (single unsealed instance, known root token) —
**DEV/TEST ONLY**. The OpenBao **UI is `not_exposed`** in the clickthrough policy
(a secrets console is never tenant-reachable; operators use the direct port). See
`docs/evidence/platform/provider-environment-classification.md`.

## Proofs (live)

| Proof | What it proves |
| --- | --- |
| `proof:secret-store-contract` | Built-in store (live Postgres): opaque ref, value-free metadata/list, `resolve()` returns the value server-internally, rotation bumps version, revoke disables resolution, delete removes metadata, **tenant A cannot resolve/read tenant B's ref**, value **encrypted at rest**, audit carries **no value**, readiness ready. |
| `proof:secrets-openbao` | Composed OpenBao (live OpenBao + Postgres): value round-trips through OpenBao, **no value in Postgres** (`encrypted_value` NULL, `backend_path` set), tenant isolation, revoke/delete, readiness ready. SKIPs honestly if OpenBao is down. |
| `proof:provider-secrets-readiness` | Built-in ready; **OpenBao-unreachable ⇒ degraded**; no secret-bearing field in any readiness payload. |

All three pass locally:

```text
proof:secret-store-contract        — 19/19 PASS (live Postgres)
proof:secrets-openbao              —  9/9  PASS (live OpenBao 2.2.0 + Postgres)
proof:provider-secrets-readiness   —  4/4  PASS
```

A skipped proof can never upgrade a registry status — OpenBao is `delivered`
because `proof:secrets-openbao` proved a live write/read round-trip against the
composed provider, not from compose availability alone.

## No-secret guarantee

The value is write-only on the wire (`POST /api/admin/secrets` only); it is never
returned by list/get/readiness, never logged, and never placed in an audit row (audit
carries the name/ref only). At rest it is AES-256-GCM encrypted (built-in) or held in
OpenBao (Postgres `encrypted_value` is NULL). The proofs assert no plaintext leaks
into responses, metadata rows, or readiness payloads.

## Not delivered (Proposed sub-decisions)

- Production sealed/HA/auto-unseal OpenBao topology with externalised credentials.
- Automatic rotation + dynamic/leased secrets (today: operator-driven rotation).
- A secrets admin UI (operator API only this pass).

## Linkage

ADR-0069 · ADR-ACT-0265 · registry `runtime-secrets` → `locally proven` ·
`docs/evidence/platform/provider-environment-classification.md` (OpenBao row).
