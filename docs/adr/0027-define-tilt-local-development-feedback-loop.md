# ADR-0027: Define Tilt local development feedback loop

## Status

Accepted

## Date

2026-05-29

## Decision owner

Architecture owner / technical lead.

## Consulted

- Engineering team
- Product owner

## Context

The platform has reached a point where a developer touching any part of the
codebase needs to know immediately: what changed, what must restart, what
tests or checks are affected, and whether the local stack is healthy.

Recent milestones that created this need:

- Docker Compose default services (postgres, redis, clickhouse, minio,
  mailpit, otel-collector) with profile-gated additions for Keycloak,
  SonarQube, LocalStack, and Sentry (ADR-0017).
- Docker Compose `web` profile: `platform-api` container and a Caddy-served
  production React SPA container as a complete, deployable-to-production
  stack.
- Vite dev server (`npm run test:e2e` via `playwright.config.ts`) and
  production preview (`npm run test:e2e:prod` via `playwright.prod.config.ts`),
  each with their own service lifecycle and proxy rules.
- aldous.info live smoke tests (`playwright.aldous.config.ts`) targeting the
  deployed Cloudflare-proxied origin.
- architecture/orchestrator governance checks (ADR-0011) that must run on
  every meaningful change.
- i18n runtime and migration work pending (ADR-0026, ADR-ACT-0120–0124).

The Makefile remains the canonical command index and the CI pipeline is the
authoritative gate. Docker Compose remains the service-definition owner.
Neither provides the fast, visual, change-aware feedback that a developer
needs during a working session. Today a developer must remember which
commands to re-run after which kinds of changes, and there is no single view
showing which services are healthy, which checks are passing, and what is
blocked.

Tilt fills that gap. It is a local control plane for the development feedback
loop — not a replacement for any existing layer.

## Stakeholder concerns

- **Engineering:**
  - Need a single entry point (`tilt up`) that starts the right services and
    watches the right files.
  - Need change-aware restarts: editing `main.tsx` should restart the React
    dev server, not Postgres.
  - Need visual, real-time health status across all local services and checks.
  - Need the production-parity path (`web` Compose profile + production E2E)
    to be accessible without memorising a sequence of commands.
  - Must not break CI — Tilt is local-only.

- **Architecture:**
  - Tilt must not duplicate or bypass Makefile commands, Compose definitions,
    or Playwright configuration.
  - Governance checks (orchestrator, lint, typecheck) must remain in Tilt as
    wrappers around the canonical commands, not reimplementations.
  - No secrets may be embedded in the Tiltfile.

- **Product:**
  - Developer feedback loop speed directly affects feature delivery pace.
  - i18n key validation (ADR-0026) must be part of the feedback loop so
    missing keys are caught at development time, not in CI.

## Decision drivers

- The platform has enough runtime surfaces that manual orchestration is a
  cognitive burden.
- Fast vs. production-parity modes require different service topologies; a
  developer should be able to switch without memorising commands.
- i18n, auth, infra, and E2E surfaces now interact in non-obvious ways;
  change-impact grouping makes the dependency graph visible.
- CI and Makefile gates are batch-oriented and slow; Tilt provides the
  inner-loop complement.

## Options considered

### Option A: Extend Makefile with watch targets

Add `make watch-react`, `make watch-api`, `make watch-tests` targets using
`entr` or similar.

Pros:

- No new tool dependency.
- Consistent with existing Makefile approach.

Cons:

- Multiple terminal windows required for parallel services.
- No visual health dashboard.
- No dependency graph between resources.
- Change-impact routing (which watch target to trigger for a given file change)
  must be manually maintained.
- Does not unify service start, watch, and check in a single interface.

### Option B: Custom shell script or Procfile (e.g. Overmind, Foreman)

Run services and watchers with a process manager.

Pros:

- Lightweight.
- No Tilt dependency.

Cons:

- Procfile-style tools manage processes, not change-impact routing.
- No dependency graph or readiness probes.
- No UI for status.
- Must reinvent file-watching logic for check orchestration.

### Option C: Tilt (chosen)

Tilt is a purpose-built local development orchestration tool. It provides:

- Docker Compose integration via `docker_compose()`.
- `local_resource()` for host commands and checks.
- File-watch-driven rebuild and restart.
- Dependency graph via `resource_deps`.
- Readiness probes.
- Labels for resource grouping and filtering.
- A browser-based UI (`tilt ui`).
- `trigger_mode(TRIGGER_MODE_MANUAL)` for expensive operations.
- Links to local app surfaces.

Cons:

- Introduces a new tool dependency.
- Tiltfile is another file to maintain.

Decision: the complexity now exists; Tilt makes it manageable. The tool
boundary is well-defined: Tilt orchestrates; it does not own or replace any
existing tool.

## Decision

Use Tilt as the local development feedback loop for:

- service orchestration
- file-watch-driven rebuild/restart of local dev servers
- rapid change-impact assessment across all platform surfaces
- grouped resource health via the Tilt UI
- manual-trigger access to expensive checks and production-parity flows
- links to local app, API health, Mailpit, Keycloak, SonarQube, and Tilt UI

Tilt must not replace or duplicate:

| Existing layer                                                   | What it owns                                              | Tilt's relationship                                                                                                        |
| ---------------------------------------------------------------- | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Makefile                                                         | Canonical command index; CI gate                          | Tilt wraps Make commands; does not reimplement them                                                                        |
| CI pipeline                                                      | Authoritative quality gate                                | Tilt is local-only; CI is the final authority                                                                              |
| Docker Compose (`compose.yaml`)                                  | Service definitions, images, ports, healthchecks, volumes | Tilt calls `docker_compose()`; it does not redefine services                                                               |
| Playwright (`playwright.config.ts`, `playwright.prod.config.ts`) | E2E runner and configuration                              | Tilt triggers `npx playwright test`; it does not reimport or reconfigure Playwright                                        |
| architecture/orchestrator (ADR-0011)                             | Governance gate ordering                                  | Tilt calls `node tools/architecture/orchestrator/src/index.mjs all --no-reports --strict`; it does not duplicate the logic |
| Terraform/OpenTofu (ADR-0023)                                    | Identity provisioning, cloud infrastructure               | Tilt may provide a manual trigger for `infra/bin/tf plan`; it does not own provisioning                                    |

---

## Two operating modes

### Mode 1 — Fast dev (default: `tilt up`)

Optimises for iteration speed. Uses host processes for the application tier
so file changes rebuild and restart in seconds, not minutes.

| Resource                                                    | How it runs                                                                                       | Rebuild trigger                                                                           |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| postgres, redis, clickhouse, minio, mailpit, otel-collector | Docker Compose (default profile)                                                                  | `compose.yaml` changes                                                                    |
| platform-api                                                | `local_resource` `serve_cmd` (`npm run api:start:admin`)                                          | `apps/platform-api/src/**`, `packages/**`                                                 |
| react-enterprise-app                                        | `local_resource` `serve_cmd` (Vite dev: `cd apps/react-enterprise-app && npx vite`)               | `apps/react-enterprise-app/src/**`, `packages/**`                                         |
| typecheck                                                   | `local_resource` (`npm run tsc:check`)                                                            | `**/*.ts`, `**/*.tsx`, `tsconfig*.json`                                                   |
| lint                                                        | `local_resource` (`npm run lint && npm run lint:md`)                                              | `**/*.ts`, `**/*.tsx`, `**/*.md`                                                          |
| architecture-orchestrator                                   | `local_resource` (`node tools/architecture/orchestrator/src/index.mjs all --no-reports --strict`) | `apps/**/package.json`, `packages/**/package.json`, `docs/adr/**`, `docs/architecture/**` |
| platform-api-tests                                          | `local_resource` (`npm run test:platform-api`)                                                    | `apps/platform-api/src/**`, `apps/platform-api/tests/**`, `packages/**`                   |
| react-tests                                                 | `local_resource` (`npm run test:frontend:run`)                                                    | `apps/react-enterprise-app/src/**`, `packages/**`                                         |
| e2e-dev                                                     | `local_resource` (`npm run test:e2e`) — **manual trigger**                                        | Manual only                                                                               |
| i18n-validation                                             | `local_resource` (future: key validation gate from ADR-ACT-0123)                                  | `packages/i18n-runtime/locales/**`, `apps/react-enterprise-app/src/**`                    |

### Mode 2 — Production parity (manual entry: `tilt up -- --mode=production`)

Optimises for production fidelity. Uses the Compose `web` profile (containers)
and the production SPA build. Slower to start; manual by default.

| Resource              | How it runs                                                                                        | Rebuild trigger                                                                                      |
| --------------------- | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| postgres, redis, etc. | Docker Compose (default profile)                                                                   | `compose.yaml` changes                                                                               |
| platform-api          | Docker Compose `web` profile (`docker compose --profile web up platform-api`)                      | `apps/platform-api/Dockerfile`, `apps/platform-api/src/**`                                           |
| react-app (Caddy)     | Docker Compose `web` profile (`docker compose --profile web up react-app`)                         | `apps/react-enterprise-app/Dockerfile`, `apps/react-enterprise-app/src/**`, `docker/caddy/Caddyfile` |
| e2e-prod              | `local_resource` (`npm run test:e2e:prod`) — **manual trigger**                                    | Manual only                                                                                          |
| aldous-smoke          | `local_resource` (`npx playwright test --config playwright.aldous.config.ts`) — **manual trigger** | Manual only                                                                                          |

Mode switching is via a Tiltfile extension parameter or a named extension file
(e.g. `tilt-production.env`). The Tiltfile must document how to activate each
mode.

---

## Resource groups and labels

Resources must be labelled so the Tilt UI allows filtering by surface:

| Label            | Resources                                                   |
| ---------------- | ----------------------------------------------------------- |
| `infra`          | postgres, redis, clickhouse, minio, mailpit, otel-collector |
| `app`            | platform-api (dev), react-enterprise-app (dev)              |
| `app:production` | platform-api (container), react-app (Caddy container)       |
| `auth`           | keycloak (identity profile, opt-in)                         |
| `quality`        | typecheck, lint, architecture-orchestrator, i18n-validation |
| `tests`          | platform-api-tests, react-tests, e2e-dev, e2e-prod          |
| `governance`     | adr-lint, readme-check (if added)                           |

---

## Trigger strategy

Resources use one of two trigger modes:

### Auto-trigger (fast, cheap)

These resources re-run automatically when watched files change:

- All infra Compose services (on `compose.yaml` changes, Docker restarts automatically)
- platform-api dev server
- react-enterprise-app dev server
- typecheck
- lint
- platform-api-tests
- react-tests
- architecture-orchestrator
- i18n-validation (once ADR-ACT-0123 exists)

Auto-trigger resources must complete in under 30 seconds to remain useful as
an inner loop. If a resource exceeds that budget, it should be demoted to
manual trigger.

### Manual trigger (slow, expensive, or live-environment)

These resources require explicit developer action (`tilt trigger <resource>`
or a button in the Tilt UI):

- e2e-dev (full Playwright dev suite: ~6 seconds today but may grow)
- e2e-prod (production SPA build + Playwright: ~2 minutes)
- aldous-smoke (live `aldous.info` tests: requires external connectivity)
- make-all (full `make all`: includes Sonar, SBOM, compose smoke)
- sonar-scan (requires `SONAR_TOKEN`)
- infra-keycloak-plan (Terraform plan for local Keycloak: requires identity Compose profile)
- compose-smoke (requires all default services healthy)

Manual-trigger resources are visible in the Tilt UI and clearly labelled so
developers know they exist without having to run them automatically.

---

## Change-impact dependency mapping

The Tiltfile must express these relationships so Tilt restarts only what is
actually affected by a change:

| File changed                                                                              | Resources to restart or re-run                                                                           |
| ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `apps/react-enterprise-app/src/**`, `apps/react-enterprise-app/public/**`                 | react-enterprise-app (dev server), react-tests                                                           |
| `apps/platform-api/src/**`                                                                | platform-api (dev server), platform-api-tests                                                            |
| `packages/**` (any platform package)                                                      | react-enterprise-app (dev server), platform-api (dev server), typecheck, react-tests, platform-api-tests |
| `packages/contracts-*/src/**`                                                             | react-enterprise-app, platform-api, typecheck, react-tests, platform-api-tests                           |
| `packages/i18n-runtime/locales/**`                                                        | i18n-validation, react-tests                                                                             |
| `apps/react-enterprise-app/Dockerfile`                                                    | react-app (production container only, manual)                                                            |
| `apps/platform-api/Dockerfile`                                                            | platform-api (production container only, manual)                                                         |
| `docker/caddy/Caddyfile`                                                                  | react-app (production container only, manual)                                                            |
| `docker/entrypoint-api.sh`                                                                | platform-api (production container only, manual)                                                         |
| `compose.yaml`                                                                            | All Compose-backed resources                                                                             |
| `docs/adr/**`, `docs/architecture/**`, `packages/**/package.json`, `apps/**/package.json` | architecture-orchestrator                                                                                |
| `**/*.md`                                                                                 | lint (markdown lint)                                                                                     |
| `**/*.ts`, `**/*.tsx`, `tsconfig*.json`                                                   | typecheck, lint                                                                                          |
| `eslint.config.mjs`, `.prettierrc.json`                                                   | lint                                                                                                     |
| `infra/**`                                                                                | infra-keycloak-plan (manual trigger only)                                                                |
| `playwright.config.ts`                                                                    | e2e-dev (manual)                                                                                         |
| `playwright.prod.config.ts`                                                               | e2e-prod (manual)                                                                                        |
| `playwright.aldous.config.ts`                                                             | aldous-smoke (manual)                                                                                    |

This mapping must be maintained in the Tiltfile using `watch_file()` or the
`deps` argument to `local_resource()`. It must not be implicit.

---

## Tiltfile acceptance criteria

The Tiltfile produced as part of ADR-ACT-0127 must satisfy:

1. **Location:** repo root as `Tiltfile` (no subdirectory).
2. **Compose integration:** calls `docker_compose("compose.yaml")` to load
   Compose service definitions; does not redefine services.
3. **Dev app servers:** uses `local_resource()` with `serve_cmd` for
   platform-api and react-enterprise-app in fast dev mode.
4. **Local resource commands:** all commands delegate to the canonical Make
   targets or `npm run` scripts; no reimplementation of tool logic in the
   Tiltfile itself.
5. **Labels:** every resource has a label from the groups defined above.
6. **Dependencies:** `resource_deps` correctly express startup ordering
   (e.g. platform-api must wait for postgres and redis to be healthy; react
   tests must wait for react-enterprise-app).
7. **Links:** exposes the following links in the Tilt UI:
   - React app: `http://localhost:5173`
   - platform-api health: `http://localhost:3001/healthz`
   - platform-api readiness: `http://localhost:3001/readyz`
   - Mailpit UI: `http://localhost:8025`
   - Keycloak admin (if identity profile active): `http://localhost:8080`
   - SonarQube (if quality profile active): `http://localhost:9003`
   - Tilt UI: `http://localhost:10350`
8. **Readiness probes:** platform-api and keycloak must use
   `readiness_probe(http_get="/healthz", ...)` or equivalent so dependent
   resources wait for them to be ready.
9. **Trigger modes:** auto-trigger resources (listed above) use the default
   `TRIGGER_MODE_AUTO`; manual-trigger resources use
   `trigger_mode(TRIGGER_MODE_MANUAL)`.
10. **Production parity:** production-parity resources are clearly separated,
    labelled `app:production`, and not started in fast dev mode unless
    explicitly requested.
11. **Secrets:** no secret values, API keys, or credentials may appear in
    the Tiltfile. Secrets are loaded via `.env` (gitignored) or Compose
    environment variable defaults.
12. **Excluded artifacts:** the Tiltfile must not write reports, traces,
    screenshots, `*.tfstate`, `*.tfvars`, `.terraform/`, or coverage output
    to version-controlled paths.
13. **Documentation:** the Tiltfile must include a comment block at the top
    documenting `tilt up`, `tilt down`, mode switching, and profile activation.

---

## What Tilt does not own

To avoid scope creep, the following boundaries are explicit:

- **Tilt does not define Docker images.** `Dockerfile`s are owned by their
  respective `apps/` directories. Tilt may trigger a Compose build but does
  not write build specifications.
- **Tilt does not define Compose services.** `compose.yaml` is the single
  source of truth for service definitions, ports, healthchecks, and volumes
  (ADR-0017).
- **Tilt does not provision identity.** Keycloak realm, clients, and roles
  are owned by `infra/modules/keycloak/` and provisioned via
  `infra/bin/tf apply` (ADR-0023). Tilt may expose a manual trigger for
  `make keycloak-plan-local` but does not provision itself.
- **Tilt does not own E2E configuration.** `playwright.config.ts`,
  `playwright.prod.config.ts`, and `playwright.aldous.config.ts` are owned
  by the platform; Tilt triggers them unchanged.
- **Tilt does not own CI.** The Tiltfile is a local-developer tool only.
  CI pipelines (`.github/workflows/ci.yml`) do not import or depend on the
  Tiltfile.
- **Tilt does not own the quality gate definition.** `make check` and
  `make all` remain the canonical quality commands. Tilt wraps them.
- **Tilt does not own i18n resources.** Translation JSON files in
  `packages/i18n-runtime/locales/` are owned by ADR-0026 and the i18n
  runtime package. Tilt triggers the validation gate but does not edit keys.

---

## Kubernetes and future topology

The current platform uses Docker Compose and host processes only. There are
no Kubernetes manifests, no Helm charts, and no cluster configuration in
this repository.

Tilt natively supports Kubernetes, but introducing Kubernetes resources to
this ADR before they exist would be over-scoping. If the platform later
adopts MicroK8s, Kind, or a managed cluster, a separate ADR (e.g.
ADR-0028) must define the Kubernetes topology and Tilt must be extended
under that decision.

This ADR governs Compose + local resources only.

---

## Consequences

Implementation is tracked in the following ACTION-REGISTER actions:

- **ADR-ACT-0126:** Create ADR-0027 for Tilt local development feedback loop.
  (This ADR — governance only, no Tiltfile.)
- **ADR-ACT-0127:** Implement root Tiltfile fast-dev mode. Wire infra Compose
  services, platform-api dev server, react-enterprise-app dev server, and
  auto-trigger quality checks (typecheck, lint, architecture-orchestrator,
  platform-api-tests, react-tests). Add resource labels and links.
- **ADR-ACT-0128:** Add production-parity Tilt resources. Wire Compose `web`
  profile resources (platform-api container, react-app/Caddy container),
  production E2E smoke gate, and Keycloak identity profile trigger.
- **ADR-ACT-0129:** Add change-impact local_resource checks for React, API,
  contracts, i18n, and governance surfaces. Wire `resource_deps` to express
  the dependency mapping defined in this ADR. Add i18n-validation trigger
  once ADR-ACT-0123 is complete.
- **ADR-ACT-0130:** Add documentation and evidence for Tilt workflow.
  Document `tilt up`, `tilt down`, mode switching, profile activation, and
  expected local URLs in `docs/local-development/tilt-workflow.md`.
  Commit evidence at `docs/evidence/infrastructure/tilt-feedback-loop.md`.

### Positive

- Single entry point for the local development environment.
- Change-aware restarts reduce unnecessary rebuild work.
- Visual health status for all services and checks.
- Production-parity path is one manual trigger away instead of a memorised
  command sequence.
- Dependency mapping makes the platform's surface interactions explicit.

### Negative

- New tool dependency: Tilt must be installed locally (`brew install tilt`
  or `curl -fsSL https://raw.githubusercontent.com/tilt-dev/tilt/master/scripts/install.sh | bash`).
- Tiltfile must be maintained as services and checks evolve.
- Fast dev mode and production parity mode diverge; integration gaps may
  appear that only production E2E catches.

### Neutral

- CI is unaffected. Tiltfile is not imported by any CI workflow.
- Makefile targets remain unchanged. Tilt calls them; it does not replace them.
- Docker Compose service definitions are unaffected.

## Links

- [Tilt documentation](https://docs.tilt.dev)
- [docker_compose()](https://api.tilt.dev/core/docker-compose-service.html)
- [local_resource()](https://api.tilt.dev/core/local-resource.html)
- [trigger_mode()](https://api.tilt.dev/core/trigger-mode.html)
- [resource_deps](https://api.tilt.dev/core/resource-deps.html)
- [ADR-0011](0011-define-architecture-tooling-execution-model.md) — Architecture tooling execution model
- [ADR-0017](0017-define-local-integration-service-substrate.md) — Local integration service substrate
- [ADR-0023](0023-define-declarative-infrastructure-provisioning-model.md) — Declarative infrastructure provisioning model
- [ADR-0025](0025-define-playwright-end-to-end-testing-strategy.md) — Playwright E2E testing strategy
- [ADR-0026](0026-define-internationalisation-and-translation-resource-model.md) — Internationalisation and translation resource model
