# ADR-0069: Central runtime secrets store (built-in Postgres + composed OpenBao)

## Status

Accepted (2026-06-13, ADR-ACT-0265 — Tier-1 kernel provider pass; accepted on Matt's authority per the directive). The built-in Postgres secret store and the composed **OpenBao** provider are both **delivered + live-proven**. Rotation automation, dynamic/leased secrets, and a production sealed/HA/auto-unseal OpenBao topology remain **Proposed** sub-decisions (not delivered here).

## Date

2026-06-13

## Decision owner

Architecture owner / security owner

## Consulted

Security; engineering; platform; AI assistant (drafting, human review required).

## Context

The platform held credentials two ways: session-token encryption and **write-only** secret settings (ADR-0041/0043/0047) — useful patterns, but neither is a _central runtime secrets manager_ with a single referenceable handle, lifecycle (revoke/rotate/delete), pluggable backend, and honest readiness. ADR-0055/0031 flagged a Vault-style manager as a Tier-1 kernel gap; LocalStack `secretsmanager` is mock-only and must never be a production substrate. This ADR splits _runtime secrets_ into its own decision and delivers a `SecretStorePort` with a built-in durable default and a composed open-source provider.

## Decision (delivered)

1. **`SecretStorePort` (build):** a capability port for storing a secret by logical name and receiving an **opaque `secret:<uuid>` reference**. The plaintext value is **never** returned by any metadata/list/readiness path; `resolve()` is the only value-returning method and is **server-internal** (a consumer fetching its own configured secret) — it is never wired to an HTTP response.
2. **Built-in Postgres store (build, default):** `secret_refs` (migration 031), tenant-scoped (RLS). The value is AES-256-GCM encrypted at rest (ADR-0047 `tenant-secret-crypto`). Durable, always-on, the local-first default.
3. **Composed OpenBao provider (compose + adapter):** OpenBao (open-source, Vault-compatible). The **value** lives in OpenBao KV v2; only value-free metadata + the backend path is mirrored in `secret_refs` (so the operator surface, audit, and tenant isolation are identical across backends). Talks to OpenBao over HTTP with the global `fetch` — **no new npm dependency**. Selected when `SECRET_STORE_PROVIDER=openbao` and `OPENBAO_ADDR`/`OPENBAO_TOKEN` are wired; otherwise the built-in store is used.
4. **Lifecycle (build):** create/rotate (rotation bumps `version`), revoke (soft-disable — the value can no longer be resolved, metadata remains), and hard delete (removes metadata + value/backend entry). All mutations are **audited (audit-before-change)** with the secret **name/ref only — never the value**.
5. **Operator surface (build):** `GET /api/admin/secrets` (list, value-free), `POST /api/admin/secrets` (create/rotate, value write-only), `POST /api/admin/secrets/revoke`, `POST /api/admin/secrets/delete`, `GET /api/admin/secrets/readiness`. Operator-only (`platform.secrets.read/write`); no tenant role gets these.
6. **Honest readiness (build):** `readiness()` probes the active backend (Postgres `SELECT 1`; OpenBao `GET /v1/sys/health`). OpenBao unreachable ⇒ `degraded`, `resolve()` returns null (the secret is unavailable — **never faked, never silently substituted**), and `put()` throws (we never record metadata for a value we could not store).

## Decision (Proposed sub-decisions — NOT delivered)

1. **Production OpenBao topology (deferred):** sealed + HA + auto-unseal (KMS/transit) with externalised credentials. The local profile runs `-dev` mode (single unsealed instance, known root token) — **dev/test only**.
2. **Automatic rotation + dynamic/leased secrets (deferred):** OpenBao dynamic secret engines + scheduled rotation behind the same port; today rotation is operator-driven (`put` over an existing name).

### Alternatives considered

1. **Built-in Postgres default + composed OpenBao behind one port (chosen).** Durable local-first store, live-provable with zero external deps; OpenBao adds the central manager without lock-in; both interchangeable behind `SecretStorePort`.
2. **OpenBao only (no built-in).** Rejected — a container before a durable default; the platform must hold secrets even when OpenBao is not composed.
3. **HashiCorp Vault.** Reasonable, but OpenBao is the open-source, license-clean, Vault-compatible fork; the adapter speaks the same KV v2 HTTP API.
4. **LocalStack Secrets Manager.** Rejected as a production substrate — mock-only (`forbidden-in-production`).
5. **`node-vault` SDK dependency.** Rejected for this pass — the KV v2 + sys/health surface is small enough to call with `fetch`, keeping the dependency-audit gates clean.

### Rejected alternatives (required)

- **Returning the secret value from any read/list/readiness path** — rejected: metadata is value-free; only `resolve()` returns a value, server-internally.
- **Faking OpenBao readiness or silently substituting the built-in store on resolve** — rejected: unreachable OpenBao reports `degraded` and `resolve()` returns null.
- **Storing the OpenBao value in Postgres too** — rejected: the OpenBao value lives only in OpenBao (`encrypted_value` NULL); Postgres holds metadata + path.
- **Tenant cross-read** — rejected: every query is organisation-scoped + RLS; tenant A cannot resolve/read tenant B's ref.
- **Secret values in logs/audit/keys** — rejected: audit carries name/ref only; no secret-bearing field in any payload.
- **Tenant-facing secret routes** — rejected: operator-only (`platform.secrets.*`).

### Accepted decision

Adopt option 1. Built-in Postgres store as the durable default + composed OpenBao behind `SecretStorePort`; production OpenBao topology + rotation automation are follow-ups.

## Implementation phases

1. **Substrate + provider (this pass, done):** migration 031 (`secret_refs`, RLS), `SecretStorePort`, `PostgresSecretStore` (encrypted at rest) + `OpenBaoSecretStore` (KV v2 over fetch), `secrets` usecase (audited), operator routes (+ OpenAPI), `secrets` compose profile (`make compose-up-secrets`), `platform.secrets.*` permissions.
2. **Production hardening (future):** sealed/HA/auto-unseal OpenBao, rotation automation, dynamic/leased secrets, per-tenant path policies — behind the same port.

## Acceptance criteria

- put returns metadata + an opaque ref and never the value; metadata/list/readiness are value-free; `resolve()` returns the value server-internally; rotation bumps version; revoke disables resolution; delete removes metadata; tenant A cannot resolve/read tenant B's ref; the built-in value is encrypted at rest; OpenBao stores the value in OpenBao (not Postgres); OpenBao-unreachable readiness is `degraded`.
- `proof:secret-store-contract` (built-in, live Postgres), `proof:secrets-openbao` (live OpenBao + Postgres), `proof:provider-secrets-readiness` pass; SKIP honestly when a backend is down. No registry status upgrade from a skipped proof.

## Proof requirements

`proof:secret-store-contract`, `proof:secrets-openbao`, `proof:provider-secrets-readiness`. OpenBao is delivered only because `proof:secrets-openbao` proves a live write/read round-trip against the composed provider — not from compose availability alone.

## Production blockers

- The local OpenBao profile is `-dev` mode (unsealed, known root token) — **not production**. Production requires a sealed/HA/auto-unsealed deployment with externalised credentials.
- Rotation automation + dynamic/leased secrets are not delivered (operator-driven rotation only).

## Consequences

Positive: a central, audited, tenant-isolated secret store with an opaque-reference model, a durable built-in default, and a composed OpenBao provider — both live-proven, no new npm dependency.

Negative: production OpenBao topology + rotation automation are follow-ups (mitigated by the port seam + the explicit dev-mode classification).

Neutral / operational: secret mutations are audited (name/ref only); the active backend is operator-configured via `SECRET_STORE_PROVIDER`.

## Validation / evidence

Evidence level: High (secret-bearing). Local proof via the three secret proofs against live Postgres + OpenBao. Evidence: `docs/evidence/platform/secrets-openbao-foundation.md`.

## Follow-up actions

Coordinated in `docs/adr/ACTION-REGISTER.md` (ADR-ACT-0265). Provider configuration plane that references secrets by `secretRef`: ADR-ACT-0266 (ADR-0070).

## References

ADR-0031, ADR-0041, ADR-0043, ADR-0047, ADR-0053, ADR-0055, ADR-0056.

## Notes

Accepted on 2026-06-13 (ADR-ACT-0265) on Matt's authority per the directive. OpenBao `-dev` mode is dev/test only; production topology is explicitly NOT delivered here.
