# Tilt local development workflow

Tilt provides a real-time local development feedback loop (ADR-0027).
It orchestrates Compose services, dev servers, and quality checks through a single `tilt up` command.

## Prerequisites

Install Tilt: <https://docs.tilt.dev/install.html>

```bash
curl -fsSL https://raw.githubusercontent.com/tilt-dev/tilt/master/scripts/install.sh | bash
```

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

| Resource                                                    | Label   | Trigger           | What it runs                                                         |
| ----------------------------------------------------------- | ------- | ----------------- | -------------------------------------------------------------------- |
| postgres, redis, clickhouse, minio, mailpit, otel-collector | infra   | auto (Compose)    | Docker Compose default profile                                       |
| platform-api                                                | app     | auto (file watch) | `npm run api:start:admin` on :3001                                   |
| react-app                                                   | app     | auto (file watch) | Vite dev server on :5173                                             |
| typecheck                                                   | quality | auto (file watch) | `npm run tsc:check`                                                  |
| lint                                                        | quality | auto (file watch) | `npm run lint && npm run lint:md`                                    |
| platform-api-tests                                          | tests   | auto (file watch) | `npm run test:platform-api`                                          |
| react-tests                                                 | tests   | auto (file watch) | `npm run test:frontend:run`                                          |
| architecture-check                                          | quality | **manual**        | orchestrator `all --strict`                                          |
| make-check                                                  | quality | **manual**        | `make check`                                                         |
| e2e-dev                                                     | tests   | **manual**        | `npm run test:e2e`                                                   |
| prod-build-and-test                                         | tests   | **manual**        | `npm run test:e2e:prod` (builds production SPA then runs Playwright) |
| aldous-smoke                                                | tests   | **manual**        | Playwright against [https://aldous.info](https://aldous.info)        |

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

## Production parity

Production parity resources are available as manual-trigger resources: `prod-build-and-test` runs the full production build and E2E suite; `aldous-smoke` runs live smoke tests against [https://aldous.info](https://aldous.info).
