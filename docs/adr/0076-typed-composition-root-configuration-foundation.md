# ADR-0076: Typed composition-root configuration foundation

- Status: Accepted
- Date: 2026-06-19
- Deciders: Architecture owner / platform
- Related: ADR-0072 (env registry + generated `.env`), ADR-0069 (OpenBao secrets), ADR-0031
  (config/secret handling), ADR-ACT-0289 (config-runtime deferred decision), ADR-ACT-0292
  (V2-readiness validator). Supersedes nothing.

## Context

The V2-readiness audit (R18, `v1-config-consumption.json`) found **188 consumed configuration keys**
(176 production) and **123 keys read directly via `process.env` outside any composition boundary**.
This sprawl was the `config-runtime` blocker, decomposed into bounded actions `V1C-CONF-01..08`. This
ADR records the final V1 configuration design and delivers the first slice
(`V1C-CONF-01/02/03/05/07/08`). It does not migrate every consumer (`V1C-CONF-06`) or move secret
resolution behind `SecretStorePort` (`V1C-CONF-04`).

## Decision

- Each deployable application has **one typed configuration object**, constructed **once at its
  composition root**: `PlatformApiConfig` (apps/platform-api) and `WebPublicConfig`
  (apps/react-enterprise-app). API/server and browser/web configuration are **separate types**.
- All required values are **validated at load**; missing or invalid required values **fail closed**
  (no production fallback). Validation collects and reports all errors together.
- Configuration objects and their projections are **deeply immutable** (frozen); consumers receive
  only typed projections, never the raw environment.
- The canonical typed-config kernel lives in **`@platform/config-runtime`** (`loadConfig`,
  `configMetadata`, `deepFreeze`, typed schema + metadata). config-runtime is **retained as the
  canonical, proven home** for these contracts — not removed — and is no longer a generic untyped bag;
  the legacy `getEnv*` helpers remain only until `V1C-CONF-06` migrates all consumers.
- Tests use an **explicit typed override seam** (`loadConfig(schema, { overrides })`); unknown
  overrides fail. Pure unit and architecture tests are **hermetic** (no generated stage secrets);
  only integration/runtime proofs load stage artefacts.
- Each property is classified **`restart-required`** or **`reloadable`**; reloadable values require an
  explicit reload mechanism, otherwise they are restart-required. Classification is surfaced in the
  generated catalogue.
- Raw environment access **outside approved composition/config boundaries is not canonical**; the
  prohibition + full migration is `V1C-CONF-06`. Secret resolution remains behind `SecretStorePort`;
  the detailed secret migration is `V1C-CONF-04`.
- A machine-readable **config catalogue** (`docs/v2-foundation/v1-config-contract-catalogue.json`) is
  **generated from the typed contracts** (never hand-maintained, never carrying secret values) and
  reconciled against `v1-config-consumption.json`.

## Scope delivered (this slice)

Typed kernel (`@platform/config-runtime`); `PlatformApiConfig` + `loadPlatformApiConfig`;
`WebPublicConfig` + `loadWebPublicConfig`; representative composition-root consumers migrated
(database `POSTGRES_APP_URL`, runtime `REDIS_URL`, authentication Keycloak core, observability Loki);
hermetic typed test seam; generated catalogue. Closes `V1C-CONF-01/02/03/05/07/08`.

## Consequences

- No configuration behaviour changes: migrated getters preserve the same env keys, defaults and
  fail-closed semantics; no historical migration or environment manifest is edited.
- `V1C-CONF-06` (migrate + prohibit all remaining direct `process.env` reads) remains an open
  V2-readiness completion blocker.

## Amendment (2026-06-19, ADR-ACT-0294): two-tier secret model — V1C-CONF-04

Secrets are **not** all resolved through `SecretStorePort` (that would deadlock: credentials are
needed to _open_ OpenBao/Postgres). The final V1 model is two tiers:

- **Tier 0 — bootstrap root of trust** (`apps/platform-api/src/config/bootstrap-secrets.ts`,
  `BootstrapSecretConfig`): the minimum material to OPEN the store — `SECRET_STORE_PROVIDER`
  (**explicit**, no implicit OpenBao⇄Postgres fallback), `OPENBAO_ADDR`/`OPENBAO_TOKEN` (or the
  Postgres substrate + `TENANT_SECRET_ENCRYPTION_KEY`). Loaded only at the composition boundary from a
  deployment secret source — **mounted files (`<KEY>_FILE`) preferred**, narrow governed env fallback
  at this boundary only. Validated fail-closed, immutable, restart-required. **Never** in the
  catalogue, logs, audit, readiness, or the browser bundle. It cannot be resolved from the store it
  opens (enforced structurally: the loader takes no `SecretStore`).
- **Tier 1 — managed runtime secrets** (`ManagedSecretReferences`): carried in typed config as opaque
  `SecretRef` (`secret:…`) values and resolved through `SecretStorePort` **after** bootstrap
  (`resolveManagedSecret`, required → fail-closed; optional → null for a disabled capability). No
  Tier-1 plaintext belongs in the normal config object. Rotation: classified `restart-required` by
  default; `reloadable` only with a delivered+proven reload mechanism.

Composition order (`BootstrapSecretLoader → createSecretStoreFromBootstrap → resolveManagedSecret →
adapters → server`) is proven by `proof:typed-secret-resolution` (live, redacted) + bootstrap-cycle
tests. `selectSecretStore` is refactored to this explicit model (the prior implicit openbao→builtin
fallback is removed). The catalogue carries `secretTier ∈ none|bootstrap|managed-reference` (no
values). Closes `V1C-CONF-04`. (Wiring every live secret consumer to resolve from the store rides with
the V1C-CONF-06 per-secret cutover + provisioning.)
