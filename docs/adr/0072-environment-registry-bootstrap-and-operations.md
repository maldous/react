# ADR-0072: Environment registry, Makefile-driven bootstrap, and controlled operations

## Status

Accepted

## Date

2026-06-14

## Decision owner

Architecture owner / platform

## Consulted

ADR-0017 (local integration substrate), ADR-0034 (confidence ladder), ADR-0056
(environment-service classification), ADR-0069 (secret store), ADR-0070 (provider
configuration plane), ADR-0027 (Tilt inner loop).

## Context

The platform depended on hand-maintained env files as source inputs: a root `.env`
(shared service credentials) plus `.env.dev` / `.env.test` / `.env.staging` /
`.env.prod` (per-stage port/domain overrides), and a committed `.env.example`
template. These files were gitignored, drift-prone, and a recurring onboarding/CI
hazard: preflight required them to exist, the stage runner and `compose-wrapper`
sourced them, `core.mk` grepped them, and `loadLocalEnv` read them. Secrets lived in
those files in plaintext on developer machines. There was no first-class, queryable
model of "what environments exist and what is safe to do in each".

## Decision (delivered)

1. **Manifests are the source of truth.** Tracked, non-secret manifests
   `config/environments/<stage>.json` (+ shared `common.json`) declare environment
   bootstrap intent: id, stage, executor (Tilt/Compose), compose project, stage
   policy, allowed profiles/mocks, seeded provider defaults, admin identity policy,
   and the non-secret runtime key map. No secret value may appear in a manifest.

2. **Generated runtime env is an artifact only.** `make env-generate-runtime`
   produces `.env/<stage>.env` (gitignored, reproducible, non-authoritative, safe to
   delete) from the manifest. It is a COMPLETE runtime env (shared base + stage +
   secrets). Secrets are seeded from OpenBao (ADR-0069) material or derived
   deterministically as local-bootstrap; only the two connection-URL passwords are
   pinned to match the committed URLs (the documented Compose-bootstrap limitation).

3. **No hand-maintained env file is required.** Root `.env`, `.env.<stage>`, and
   `.env.example` are removed. `compose-wrapper`, the stage runner, `core.mk`, the
   smoke/clean/backup/tilt scripts, the node port/evidence consumers, and
   `loadLocalEnv` all resolve the generated artifact (legacy files remain a
   transition fallback only). The `Makefile` `-include` is guarded so the `.env/`
   directory is never mistaken for a file.

4. **Manifest validator replaces the env-file validators.**
   `scripts/env/validate-manifests.mjs` supersedes `check-env-files.mjs` +
   `check-env-drift.mjs`. It fails on: a secret-looking key/value in any manifest or
   `common.json`; a stage-policy contradiction (executor/auth/cookie/apex/node-env/
   log-level/destructive); a mock provider allowed in staging/production; a fixture
   session leaking into staging/production; an incomplete deployment ladder; a stale
   or incomplete generated artifact; a tracked generated/secret artifact. It is a
   hard gate via `preflight` and `env-validate-all` (both in `make all`).

5. **Environment registry.** `environment_registry` (migration 033) +
   `EnvironmentRegistryRepository` + usecase is the application's canonical
   understanding of the ladder, projected from the manifests plus operational
   lifecycle (bootstrap/reconcile/provider-config status). DB CHECK constraints
   forbid mocks and destructive operations in staging/production as defence-in-depth.

6. **Controlled operations boundary.** `EnvironmentOperationPort` is a CLOSED enum of
   operations — there is no free-form command field, so arbitrary shell / compose /
   docker-socket access is impossible by construction. `ComposeEnvironmentOperation`
   resolves each op to a whitelisted argv from the registry record (no shell), rejects
   unknown/mock-in-prod profiles, never passes `-v/--volumes` on down/restart,
   pattern-validates rotate keys + proof names, and is dry-run capable. The wrapping
   usecase enforces a `platform.environment.*` permission and audits every operation.

7. **Makefile owns the deployment ladder bootstrap.** New targets — `env-bootstrap`,
   `env-init`, `env-reconcile`, `env-seed-secrets`, `env-seed-providers`,
   `env-seed-config`, `env-seed-admin`, `env-print-admin`, `env-rotate-secret`,
   `env-provider-up`, `env-provider-reconcile`, `env-generate-runtime` — orchestrate
   the generator + OpenBao + provider_configs + registry. The stage runner runs
   `env-bootstrap-seed` after migrations (non-fatal) so `make all` performs the full
   end state per stage. A per-environment **global system administrator handoff** is
   generated (username from the manifest, one-time password from the artifact, opaque
   secretRef); the persisted marker holds no plaintext; staging/prod are flagged
   local-bootstrap (rotate before exposure). Every seed step degrades honestly (SKIP,
   never fail/fake) when Postgres/OpenBao is unreachable, so the confidence ladder
   (ADR-0034) is preserved unchanged.

### Alternatives considered

### Rejected alternatives (required)

- **Keep hand-maintained `.env.*` as source inputs** — rejected: drift-prone,
  secret-bearing, the onboarding/CI hazard this ADR removes.
- **Commit generated `.env/<stage>.env`** — rejected: artifacts are gitignored,
  reproducible, non-authoritative; committing them re-introduces drift + secret leak.
- **Put secrets in manifests** — rejected: the validator fails on any secret-looking
  key/value; secrets live in OpenBao (ADR-0069), bindings in `provider_configs`.
- **A free-form command field on the operations port** — rejected: the op set is a
  closed enum so arbitrary shell/compose/docker-socket is impossible by construction.
- **Self-asserted provider/bootstrap readiness** — rejected: provider lifecycle stays
  `candidate` until adapter-confirmed (ADR-0070); bootstrap status is recorded, never
  faked.
- **Allow a mock provider in staging/production** — rejected at the manifest
  validator, the registry DB CHECK, and the operations adapter. A documented temporary
  exception (ADR-ACT-0157 prod mock-IdP) is surfaced as a loud warning, not silently.

### Accepted decision

The seven points above.

## Implementation phases

1. Manifests + generator + validator + consumer rewiring (env-file removal).
2. Environment registry (migration/port/adapter/usecase/proof).
3. Environment operations port + compose adapter + proof.
4. Make-driven bootstrap + global admin handoff + seed orchestration + proof.

## Acceptance criteria

- `make all` no longer requires any hand-maintained `.env*` file.
- Manifests validate; generated artifacts are gitignored and reproducible.
- A secret-looking value cannot live in a manifest; provider bindings are secretRefs.
- A global admin is generated per environment; plaintext appears only in the handoff.
- Mocks cannot start in staging/production; arbitrary operations cannot be expressed.

## Proof requirements

`proof:environment-registry`, `proof:environment-operations`,
`proof:environment-admin-bootstrap` (delivered). Manifest + generated-output
validation via `make env-validate-all` / `preflight`.

## Production blockers

- Staging/prod secret material is LOCAL BOOTSTRAP until seeded from a real OpenBao
  (or external token); it must be rotated before real exposure.
- The temporary prod mock-IdP (ADR-ACT-0157) must be removed before real providers.

## Consequences

- Onboarding and CI no longer hinge on a developer's local env files.
- The application has a queryable, audited model of the deployment ladder.
- Environment operations are whitelisted, audited, port-backed, and dry-run capable.

## Validation / evidence

- `docs/evidence/platform/environment-registry-foundation.md`
- `docs/evidence/platform/environment-bootstrap-contract.md`
- `docs/evidence/platform/environment-operations-foundation.md`
- `docs/evidence/platform/minimal-env-removal.md`

## Follow-up actions

See ADR-ACT-0274. Not delivered in this pass: an `/admin/environments` REST/UI
surface; full DB-password rotation (provider-credential rotation is modelled; DB
rotation requires the create→write-ref→regenerate→restart→verify→revoke flow);
IdP-backed creation of the sysadmin Keycloak user (the handoff + OpenBao seed are
delivered).

## References

ADR-0017, ADR-0034, ADR-0056, ADR-0069, ADR-0070. Supersedes the env-file aspects of
ADR-0017 (`.env.example` / `cp .env.example .env`).

## Notes

The two pinned connection-URL passwords (`platformpassword`, `clickhousepassword`)
already appear in the committed connection URLs; all other secret material is derived
or OpenBao-seeded and never committed.
