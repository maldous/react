# ADR-0070: Provider configuration plane

## Status

Accepted (2026-06-13, ADR-ACT-0266 — Tier-1 kernel provider pass; accepted on Matt's authority per the directive). The configuration plane (port + Postgres adapter + usecase + operator surface + validation) is **delivered + live-proven**. A self-service/per-tenant provider override model remains a **Proposed** sub-decision (not delivered here).

## Date

2026-06-13

## Decision owner

Architecture owner / platform owner

## Consulted

Platform; security; engineering; AI assistant (drafting, human review required).

## Context

Composed providers (search, secrets, observability, workflow, …) need a first-class place to record _which concrete provider serves a capability in a given environment_, its environment classification (ADR-0056), lifecycle state, non-secret endpoint/config, and its **credentials by reference** (into the ADR-0069 secret store). Without this plane, provider wiring is scattered across env vars with no audit, no validation, and no honest lifecycle. This ADR adds the plane that ties together the service catalog (ADR-0055), environment classification (ADR-0056), secrets (ADR-0069), and provider readiness.

## Decision (delivered)

1. **`ProviderConfigRepository` (build):** `provider_configs` (migration 032) — operator-global infra (no tenant column; accessed via `withSystemAdmin`, mirroring `worker_heartbeats`). Keyed by `(provider_key, environment, instance_label)`.
2. **Model:** a provider instance binds `providerKey` → `capability` for an `environment`, with a `classification` (ADR-0056 vocabulary), a `lifecycleState` (`candidate | configured | degraded | ready | disabled`), a non-secret `endpoint` + `config`, and a `credentialRef` — an **opaque `secret:<uuid>`** into the secret store. **No plaintext secret is ever stored here** (DB CHECK: `credential_ref LIKE 'secret:%'`).
3. **Validation (build):** the usecase rejects (a) a `credentialRef` that is not a secret-store ref, (b) `config` containing a secret-bearing key (secrets go through `credentialRef` only), and (c) a `forbidden-in-production` (mock) provider set active (`configured`/`ready`) in `production` (also a DB CHECK). A provider that **requires a credential but has none is forced to `degraded`**.
4. **Adapter-confirmed readiness (build):** `deriveReadinessLifecycle(config, adapterResult)` — a provider is `ready` ONLY when a LIVE adapter result says ready; a configured provider whose adapter is unreachable is `degraded`; the registry config can **never assert `ready` by itself** (a candidate is never a delivered capability).
5. **Operator surface (build):** `GET/POST /api/admin/provider-configs`, `POST /api/admin/provider-configs/:id/lifecycle`, `POST /api/admin/provider-configs/:id/delete` (operator-only `platform.providers.read/write`; no tenant role). Mutations audited (audit-before-change; no secret).

## Decision (Proposed sub-decisions — NOT delivered)

1. **Per-tenant provider overrides (deferred):** today provider config is operator-global per environment; a tenant-scoped override model (a tenant choosing its own provider instance) is a later decision behind the same port.
2. **Automatic adapter-driven lifecycle reconciliation (deferred):** a background reconciler that probes each configured provider's adapter and writes back `ready`/`degraded` — today `deriveReadinessLifecycle` is invoked on demand.

### Alternatives considered

1. **Dedicated config plane with credentials by secretRef (chosen).** One audited, validated place that composes the catalog + classification + secrets + readiness; secrets never touch this table.
2. **Env vars only.** Rejected — no audit, no validation, no lifecycle, no per-environment record.
3. **Storing credentials inline (encrypted) in `provider_configs`.** Rejected — duplicates the secret store; credentials belong in ADR-0069 referenced by `secret:<uuid>`.
4. **Deriving `ready` from config presence.** Rejected — readiness must be adapter-confirmed; a configured row is not a working provider.

### Rejected alternatives (required)

- **Plaintext credential in the config plane** — rejected: `credentialRef` is an opaque secret-store ref (DB CHECK + usecase validation).
- **Secret-bearing keys in `config`** — rejected: the usecase rejects them; secrets go through `credentialRef`.
- **A mock/forbidden provider active in production** — rejected: usecase + DB CHECK forbid it.
- **`ready` asserted by the registry alone** — rejected: `ready` is adapter-confirmed.
- **A candidate implying a delivered capability** — rejected: `candidate` never auto-promotes.

### Accepted decision

Adopt option 1. An operator-global, environment-scoped provider config plane with credentials by secretRef, validation, audit, and adapter-confirmed readiness.

## Implementation phases

1. **Plane (this pass, done):** migration 032 (`provider_configs`, CHECKs), `ProviderConfigRepository` + Postgres adapter, `provider-config` usecase (validation + `deriveReadinessLifecycle`), operator routes (+ OpenAPI), `platform.providers.*` permissions.
2. **Reconciliation + tenant overrides (future):** background adapter probing → lifecycle write-back; per-tenant provider overrides — behind the same port.

## Acceptance criteria

- put/list/delete round-trip; the plane never carries a plaintext secret; a non-ref credential is rejected; a secret-bearing config key is rejected; a forbidden-in-production provider cannot be active in prod; a provider requiring a credential with none is `degraded`; a `candidate` never implies delivered; `ready` is adapter-confirmed.
- `proof:provider-config` (live Postgres) + `proof:provider-readiness-contract` pass; SKIP honestly if Postgres is down. No registry status upgrade from a skipped proof.

## Proof requirements

`proof:provider-config`, `proof:provider-readiness-contract`.

## Production blockers

- Per-tenant provider overrides + automatic adapter-driven lifecycle reconciliation are not delivered (operator-set lifecycle + on-demand `deriveReadinessLifecycle`).

## Consequences

Positive: a single audited, validated place that binds capability → provider per environment, with credentials by secretRef and adapter-confirmed readiness; composes ADR-0055/0056/0069.

Negative: lifecycle is operator-set + on-demand-derived (no background reconciler yet); per-tenant overrides deferred.

Neutral / operational: operator-global infra (no tenant data); mutations audited.

## Validation / evidence

Evidence level: High (touches secrets-by-reference + classification). Local proof via the two provider proofs. Evidence: `docs/evidence/platform/provider-config-foundation.md`.

## Follow-up actions

Coordinated in `docs/adr/ACTION-REGISTER.md` (ADR-ACT-0266). Builds on ADR-0069 (ADR-ACT-0265, secret store).

## References

ADR-0053, ADR-0054, ADR-0055, ADR-0056, ADR-0069.

## Notes

Accepted on 2026-06-13 (ADR-ACT-0266) on Matt's authority per the directive. Per-tenant overrides + automatic reconciliation are explicitly NOT delivered here.
