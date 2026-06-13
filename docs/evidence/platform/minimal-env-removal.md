# Minimal env removal — no hand-maintained env files

Source ADR: ADR-0072 · Action: ADR-ACT-0274

## Scope delivered

The platform no longer depends on any hand-maintained env file. Removed:

- root `.env` (shared service credentials + base config)
- `.env.dev`, `.env.test`, `.env.staging`, `.env.prod` (per-stage overrides)
- `.env.example` (committed template)
- `scripts/preflight/check-env-files.mjs`, `scripts/preflight/check-env-drift.mjs`

Replaced by the tracked, non-secret source of truth:

- `config/environments/{common,dev,test,staging,prod}.json`
- `scripts/env/generate-runtime-env.mjs` → `.env/<stage>.env` (gitignored,
  reproducible, COMPLETE: shared base + stage + secrets)
- `scripts/env/validate-manifests.mjs` (replaces both legacy validators)
- `scripts/env/resolve-env-file.sh` (generated artifact preferred, legacy fallback)

`compose-wrapper`, `run-stage.sh`, `core.mk`/`test.mk`/`e2e.mk`/`compose.mk`, the
smoke/clean/backup/tilt scripts, the node port/evidence consumers, and
`loadLocalEnv` all resolve the generated artifact. The `Makefile` `-include` is
guarded so the `.env/` directory is never read as a file.

## Proof (live)

- `make env-validate-all` — manifests valid, generated output fresh, no tracked
  artifact, no secret-looking key/value (1 warning: prod temporary mock exception).
- `make env-generate-runtime ENV=<stage>` is reproducible (`--check` idempotent).
- `git ls-files` shows no `.env*` tracked; `.env/` is gitignored.
- Secrets are derived/seeded, never committed; the two connection-URL passwords
  (`platformpassword`, `clickhousepassword`) match the committed URLs (documented
  Compose-bootstrap limitation).

## Shared services folded in (zero hand-maintained `.env*`)

The shared cross-environment services are now generated too — there is no
hand-maintained `.env.sonar`, `.env.sentry`, or their `.example`s:

- `config/environments/shared.json` declares the non-secret Sonar + Sentry config.
- `make env-generate-runtime ENV=sonar|sentry` (and `--all`) produces
  `.env/sonar.env` / `.env/sentry.env`.
- The runtime-provisioned SonarQube analysis token is seeded into
  `.env/secrets/sonar.env` (gitignored) by `scripts/sonar/provision-token.sh`, which
  regenerates `.env/sonar.env`; consumers (`make sonar`, `compose.mk`,
  `ensure-quality-gate.sh`, `compose-wrapper` for the `sonar`/`sentry` projects)
  resolve via `scripts/env/resolve-env-file.sh`.

PROOF: `git ls-files | grep .env` → none; `ls -a | grep '^\.env'` → only the
generated `.env/` directory. `validate-manifests` scans `common.json` + `shared.json`
for secret-looking keys and guards `.env.sonar`/`.env.sentry` against being tracked.

## Not delivered

Architecture-orchestrator integration of the manifest validator (it is enforced as a
hard Make gate via `preflight` + `env-validate-all`, both in `make all`).

## Linkage

ADR-0072 · ADR-ACT-0274 · supersedes the env-file aspects of ADR-0017.
