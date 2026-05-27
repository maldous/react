# Observability and runtime diagnostics baseline evidence

## Summary

Ratified observability, structured logging, runtime context, error primitives, and diagnostics conventions before the first vertical slice (ADR-ACT-0008). Governed by ADR-0020.

## Governance

- ADR-0020 (accepted)
- ADR-ACT-0099 (Done — ADR created)
- ADR-ACT-0100 (Open — platform-logging)
- ADR-ACT-0101 (Open — platform-runtime-context)
- ADR-ACT-0102 (Open — platform-errors)
- ADR-ACT-0103 (Open — platform-observability)
- ADR-ACT-0104 (Open — BFF health/readiness/version endpoint contract)
- Committed: 2026-05-28

## Selected stack

### Tracing and metrics

| Component | Choice | Rationale |
| --- | --- | --- |
| Trace/metrics API | `@opentelemetry/api` | Vendor-neutral; swappable exporter |
| Propagation format | W3C `traceparent` / `tracestate` | Standard; supported by all modern backends |
| Local exporter | OTLP → Compose `otel-collector` | ADR-0017 Compose default profile |
| SDK (Node) | `@opentelemetry/sdk-node` | Via `packages/adapters-opentelemetry` only |
| Browser tracing | `traceparent` header forwarding | Browser does not import OTel SDK |

### Structured logging

| Component | Choice | Rationale |
| --- | --- | --- |
| Node logger | `pino` | Fastest structured JSON logger for Node; first-class redaction |
| Browser logger | Platform abstraction over `console` | Pino is Node-only; browser uses safe wrapper |
| Platform package | `packages/platform-logging` | Centralises config, redaction, child loggers |

### Runtime context

| Component | Choice | Rationale |
| --- | --- | --- |
| Context carrier | `packages/platform-runtime-context` | Typed carrier for requestId, traceId, actor, tenant |
| Propagation | BFF → use case → adapter (function param) | No async-local-storage magic; explicit and testable |
| Browser exposure | `requestId` only via contract client helpers | No server-internal context in browser |

### Error primitives

| Component | Choice | Rationale |
| --- | --- | --- |
| Error classes | `packages/platform-errors` | Typed, HTTP-mapped, safe/internal split |
| API response shape | `{ code, message, details? }` | `safeMessage` + `safeDetails` only |
| Internal details | Log-only via `internalDetails` | Never serialised to response |

## Required log fields

All Node runtime logs must include:

| Field | Source | Required |
| --- | --- | --- |
| `level` | Pino | Yes |
| `time` | ISO timestamp | Yes |
| `requestId` | Runtime context | When in request scope |
| `traceId` | OTel span | When available |
| `spanId` | OTel span | When available |
| `packageName` | Logger scope | Yes |
| `boundedContext` | Logger scope | Yes |
| `operation` | Log site | Recommended |
| `actorId` | Runtime context | When available |
| `tenantId` | Runtime context | When available |
| `err` | Pino error serializer | When logging errors |

## Redaction policy

Redacted at root logger level (never emitted):

```text
password, passwordHash, secret, token, accessToken, refreshToken, idToken
apiKey, apiSecret, clientSecret
cookie, cookies
authorization, x-api-key, x-auth-token, x-forwarded-authorization
dsn, connectionString, databaseUrl
DATABASE_URL, SENTRY_DSN
*.password, *.secret, *.token, *.apiKey
req.headers.authorization, req.headers.cookie
res.headers["set-cookie"]
```

Rules:

- Redaction is enforced at the logger (never per-site).
- Internal error details (SQL, upstream messages, stack traces) are `debug`-level only.
- Browser logger never emits sensitive state, full request payloads, or auth context.

## Error type reference

| Class | HTTP | Retryable | Client-safe |
| --- | --- | --- | --- |
| `ValidationError` | 400 | No | Yes |
| `NotFoundError` | 404 | No | Yes |
| `ConflictError` | 409 | No | Yes |
| `UnauthorizedError` | 401 | No | Yes |
| `ForbiddenError` | 403 | No | Yes |
| `InfrastructureError` | 502/503 | Yes | No (safe message only) |
| `UnexpectedError` | 500 | No | No (safe message only) |

API response shape: `{ code: string, message: string, details?: Record<string, unknown> }`

Internal details (stack traces, SQL, upstream errors): log-only, redacted, never in response.

## Trace propagation policy

1. Browser makes HTTP request to BFF — includes `traceparent` header if a browser trace exists.
2. BFF receives request — extracts or creates span; binds `traceId`/`spanId` to `RuntimeContext`.
3. BFF calls use case — passes `RuntimeContext` as explicit parameter.
4. Use case creates child span — binds to `operationName`.
5. Use case calls adapter — passes `RuntimeContext`.
6. Adapter creates child span around external I/O (DB query, cache get, queue publish, etc.).
7. Adapter returns — span ends.
8. BFF sends response — includes `traceparent` in response if downstream needs it.

## Health endpoint contracts

### `GET /healthz`

```json
200 OK
{ "status": "ok" }
```

### `GET /readyz`

```json
200 OK
{ "status": "ready", "dependencies": { "database": "ok", "cache": "ok" } }

503 Service Unavailable
{ "status": "not-ready", "dependencies": { "database": "failed" } }
```

### `GET /version`

```json
200 OK
{ "version": "0.1.0", "gitSha": "<sha>", "buildTime": "<ISO>", "environment": "development" }
```

## Debug namespace conventions

```text
platform:<package>:<operation>      e.g. platform:platform-logging:createLogger
feature:<feature>:<operation>       e.g. feature:workflow:submitForm
adapter:<adapter>:<operation>       e.g. adapter:adapters-postgres:findUser
```

- Disabled by default (`DEBUG=""` in production).
- Same redaction policy as production logs.
- Enabled via `DEBUG=platform:*` or `DEBUG=adapter:adapters-postgres:*` etc.

## Package responsibilities

| Package | Responsibility | Node | Browser |
| --- | --- | --- | --- |
| `packages/platform-logging` | Pino-backed logger + browser logger + redaction config | Yes (Pino) | Yes (safe wrapper) |
| `packages/platform-runtime-context` | RuntimeContext type + factory helpers | Yes | Types only |
| `packages/platform-errors` | Typed error classes with safe/internal split | Yes | Types + instanceof checks |
| `packages/platform-observability` | OTel API wrapper (no SDK); span helpers; metrics API | Yes | No (OTel SDK is Node-only) |
| `packages/adapters-opentelemetry` | OTel SDK init; OTLP exporter; startup registration | Yes (only) | No |
| `packages/adapters-sentry` | Sentry SDK init and capture; wired at startup | Yes (only) | No (browser Sentry is separate) |

## Allowed and forbidden import patterns

| Consumer | Allowed | Forbidden |
| --- | --- | --- |
| `packages/domain/*` | — | pino, OTel SDK, Sentry, any platform observability package |
| `packages/features/*` | `platform-errors` (client types), `platform-runtime-context` (types only) | pino, Sentry, adapters |
| `packages/ui` | — | All logging/observability/error packages except UI-safe `ErrorState` display types |
| Use-case/application | `platform-runtime-context`, `platform-errors`, `platform-observability` (abstraction) | OTel SDK, Sentry, pino |
| Adapter packages | `platform-logging`, `platform-observability`, `platform-runtime-context`, `platform-errors` | Direct Sentry import (use adapters-sentry) |
| BFF / API runtime | All platform packages | — |

## Metric conventions

| Metric | Type | Key dimensions |
| --- | --- | --- |
| `http.server.request.duration` | Histogram | `method`, `route`, `status_code` |
| `http.server.request.count` | Counter | `method`, `route`, `status_code` |
| `http.server.error.count` | Counter | `method`, `route`, `error_code` |
| `adapter.operation.duration` | Histogram | `adapter`, `operation` |
| `adapter.operation.error.count` | Counter | `adapter`, `operation`, `error_code` |
| `usecase.duration` | Histogram | `feature`, `operation` |

Cardinality constraint: no unbounded dimensions (userId, entityId, etc.).

## First-slice expectations (ADR-ACT-0008)

1. All four platform packages exist and pass their tests.
2. At least one BFF route uses `platform-logging` with `requestId` and `traceId`.
3. At least one use case creates a child OTel span.
4. At least one adapter creates a child OTel span around external I/O.
5. API error responses use `platform-errors` classes; no raw `Error` throws reach the API boundary.
6. Redaction test: no credentials in any log line during slice development.
7. `/healthz` and `/version` endpoints exist.

## Deferred

| Item | Status |
| --- | --- |
| Prometheus scrape endpoint | Deferred — OTel collector can expose Prometheus format if needed; no feature requirement yet |
| Browser distributed tracing (full OTel SDK) | Deferred — `traceparent` header forwarding is sufficient for first slice |
| Sentry production wiring | Deferred — ADR-ACT-0089; Compose profile experimental |
| OpenTelemetry baggage propagation | Deferred — `traceparent` is sufficient; baggage adds complexity |
| `DEBUG` hot-reload in production | Not planned |

## Validation commands run

```text
npm run format:check      → All matched files use Prettier code style!
npm run lint:md           → 0 errors
npm run lint              → 0 problems
npm run tsc:check         → 0 errors
npm run test:coverage     → 180 tests, 0 failures
npm run sonar:clean       → Quality gate OK
npm run audit:deps        → 0 vulnerabilities
npm run audit:osv         → 0 issues
npm run compose:config    → valid
npm run compose:config:all → valid (all profiles)
node orchestrator all --strict → 6/6 passed
```

## ADR-ACT-0008 status

**ADR-ACT-0008 (first vertical slice) has NOT started.** This evidence establishes the complete observability and runtime diagnostics baseline required before slicing begins.
