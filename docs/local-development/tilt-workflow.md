# Tilt local development workflow

Tilt provides a real-time local development feedback loop (ADR-0027).
It orchestrates Compose services, dev servers, and quality checks through a single `tilt up` command.

## Prerequisites

Install Tilt from the official release page: <https://docs.tilt.dev/install.html>

Dev Container users: Tilt is installed automatically by `.devcontainer/post-create.sh`
using a pinned version with checksum verification (see that file for the version and SHA256).

## Quick start

```bash
# Start default Compose infra (postgres, redis, etc.) + dev servers + auto checks
tilt up

# Stop everything
tilt down

# Tilt UI (real-time resource status)
open http://localhost:10350
```

## Resources

| Resource                                                    | Label   | Trigger           | What it runs                                                                             |
| ----------------------------------------------------------- | ------- | ----------------- | ---------------------------------------------------------------------------------------- |
| postgres, redis, clickhouse, minio, mailpit, otel-collector | infra   | auto (Compose)    | Docker Compose default profile                                                           |
| platform-api                                                | app     | auto (file watch) | `npm run api:start:admin` on :3001                                                       |
| react-app                                                   | app     | auto (file watch) | Vite dev server on :5173                                                                 |
| typecheck                                                   | quality | auto (file watch) | `npm run tsc:check`                                                                      |
| lint                                                        | quality | auto (file watch) | `npm run lint && npm run lint:md`                                                        |
| platform-api-tests                                          | tests   | auto (file watch) | `npm run test:platform-api`                                                              |
| react-tests                                                 | tests   | auto (file watch) | `npm run test:frontend:run`                                                              |
| identity-profile                                            | auth    | **manual**        | `make compose-up-identity`                                                               |
| architecture-check                                          | quality | **manual**        | orchestrator `all --strict`                                                              |
| make-check                                                  | quality | **manual**        | `make check`                                                                             |
| e2e-dev                                                     | tests   | **manual**        | `npm run test:e2e`                                                                       |
| i18n-validation                                             | quality | auto              | `node tools/architecture/validate-i18n/src/index.mjs .` (report-only)                    |
| prod-build-and-test                                         | tests   | **manual**        | `npm run test:e2e:prod` (vite build + Playwright preview — not full Compose web-profile) |
| aldous-smoke                                                | tests   | **manual**        | Playwright against [https://aldous.info](https://aldous.info)                            |

## Triggering manual resources

In the Tilt UI, click the resource and press the "Trigger" button.
From the terminal:

```bash
tilt trigger architecture-check
tilt trigger make-check
tilt trigger e2e-dev
```

## Optional profiles

Start Keycloak before `tilt up` if needed:

```bash
make compose-up-identity
tilt up
```

Start WireMock before `tilt up` if needed:

```bash
make compose-up-external-mocks
tilt up
```

## Local URLs

| Service                | URL                             |
| ---------------------- | ------------------------------- |
| React SPA              | <http://localhost:5173>         |
| platform-api health    | <http://localhost:3001/healthz> |
| platform-api readiness | <http://localhost:3001/readyz>  |
| Mailpit                | <http://localhost:8025>         |
| Tilt UI                | <http://localhost:10350>        |

## Production parity (ADR-ACT-0128 — In Progress)

`prod-build-and-test` runs `npm run test:e2e:prod`: builds the Vite SPA for
production and runs Playwright against `vite preview`. This is not full
Compose web-profile production (platform-api container + Caddy container);
that wiring is deferred.

`aldous-smoke` runs Playwright against the live `https://aldous.info` deployment.
