# Provider configuration plane (Tier-1 kernel)

**ADR:** ADR-0070 · **Action:** ADR-ACT-0266 · **Status:** Delivered + locally proven
**Capability:** `provider-configuration` (foundation-cross-cutting)

## Scope delivered

A first-class config plane that binds a USF capability to a concrete provider
instance per environment — behind `ProviderConfigRepository` (`provider_configs`,
migration 032). Operator-global infra (no tenant column; `withSystemAdmin`, mirroring
`worker_heartbeats`). It composes the service catalog (ADR-0055), environment
classification (ADR-0056), and the secret store (ADR-0069).

A provider instance records: `providerKey → capability`, `environment`,
`classification`, `lifecycleState`, a non-secret `endpoint` + `config`, and a
**`credentialRef`** — an opaque `secret:<uuid>` into the ADR-0069 secret store. **No
plaintext secret is ever stored here.**

## Validation (hard rules)

| Rule | Where |
| --- | --- |
| credential is a secret-store ref, never plaintext | usecase + DB CHECK `credential_ref LIKE 'secret:%'` |
| config carries no secret-bearing keys (secrets go through credentialRef) | usecase (rejects secret/password/token/apiKey keys) |
| a forbidden-in-production (mock) provider can never be active in prod | usecase + DB CHECK |
| a provider that requires a credential but has none is degraded | usecase (deriveLifecycle) |
| lifecycle `ready` is adapter-confirmed — config alone never implies ready | `deriveReadinessLifecycle` |
| a `candidate` never implies a delivered capability | lifecycle stays candidate |

## Lifecycle

`candidate → configured → ready` (adapter-confirmed) · `degraded` (backend/credential
not usable) · `disabled`. `deriveReadinessLifecycle(config, adapterResult)` returns
`ready` ONLY when a live adapter says ready; a configured provider whose adapter is
unreachable is `degraded`; the registry config can never self-assert `ready`.

## Surface

Operator-only (`platform.providers.read/write`; no tenant role):

- `GET /api/admin/provider-configs` (optional `?capability`)
- `POST /api/admin/provider-configs` (create/rotate — validated, audited)
- `POST /api/admin/provider-configs/:id/lifecycle`
- `POST /api/admin/provider-configs/:id/delete`

Mutations are audited (`provider_config.set` / `provider_config.deleted`) with no secret.

## Proofs (live)

| Proof | What it proves |
| --- | --- |
| `proof:provider-config` | put/list/delete round-trip; no plaintext secret in the plane; a non-ref credentialRef is rejected; a secret-bearing config key is rejected; a forbidden-in-production provider cannot be active in prod; a provider that requires a credential but has none is degraded; a candidate is not a delivered capability. Live Postgres. |
| `proof:provider-readiness-contract` | `deriveReadinessLifecycle` — ready only when the adapter says ready; configured+unreachable / no-adapter ⇒ degraded; candidate/disabled unchanged. Pure (always runs). |

Both pass locally:

```text
proof:provider-config              — 10/10 PASS (live Postgres)
proof:provider-readiness-contract  —  7/7  PASS
```

## Not delivered (Proposed sub-decisions)

- Per-tenant provider overrides (today: operator-global per environment).
- Automatic adapter-driven lifecycle reconciliation (today: operator-set lifecycle +
  on-demand `deriveReadinessLifecycle`).

## Linkage

ADR-0070 · ADR-ACT-0266 · registry capability `provider-configuration` (locally
proven) · builds on ADR-0069 (`runtime-secrets`, credentials by secretRef).
