# ADR-0020: Define observability, diagnostics, and runtime introspection primitives

## Status

Accepted

## Date

2026-05-28

## Decision owner

Architecture owner / technical lead

## Consulted

- ADR-0001 (hexagonal architecture ? adapters own external integrations)
- ADR-0002 (bounded contexts ? operations domain)
- ADR-0003 (modular monorepo)
- ADR-0013 (client-facing API boundary)
- ADR-0016 (quality gate baseline)
- ADR-0017 (local integration substrate ? OTel collector in Compose)
- ADR-0019 (React component platform ? browser safety)

## Context

The first vertical slice (ADR-ACT-0008) must prove not only functional architecture but diagnosability. Without defined observability primitives before slicing, each feature package independently decides how to log, how to propagate trace context, how to surface errors to the API boundary, and how to report to monitoring systems. This creates fragmented diagnostics, insecure log content, and unmaintainable error handling.

The platform already includes:

- `packages/adapters-opentelemetry` ? OpenTelemetry SDK adapter
- `packages/observability` ? operations interface package (no `@platform` deps)
- `packages/adapters-sentry` ? Sentry error-monitoring adapter
- An `otel-collector` in the Compose default profile (ADR-0017)

This ADR defines the internal platform abstractions and conventions built on top of those adapters: structured logging, runtime context, error primitives, debug policy, health endpoints, and metric conventions.

## Stakeholder concerns

- **Security:** Logs must not emit secrets, tokens, passwords, cookies, auth headers, API keys, or DSNs. Browser diagnostics must not expose server-internal state.
- **Engineering:** Consistent structured logs with requestId/traceId enable distributed tracing across BFF and adapter calls without bespoke solutions per feature.
- **Operations:** Health and readiness endpoints must be defined before the first slice ships to production; contracts should be specified now.
- **Architecture:** Domain packages must not import logging, tracing, or Sentry SDKs directly. All observability goes through platform abstractions.
- **Compliance:** Redaction policy must cover PII, credentials, and sensitive operational metadata.

## Decision drivers

1. Every request must be traceable from browser to BFF to adapter, using W3C `traceparent` propagation.
2. Domain logic must remain decoupled from logging, tracing, and error-monitoring SDKs.
3. Error taxonomy must be typed, stable, and HTTP-safe: internal details never reach the browser.
4. Structured logs with requestId, traceId, and operation context are required from day one.
5. Redaction must be configured at the logger level, not patched per log site.
6. Local development must use the Compose OTel collector (ADR-0017) as the telemetry backend.

## Options considered

### Option A: Ad-hoc per-package logging and error handling

Each feature/adapter package imports `pino`, `winston`, or a custom logger independently. Errors are raw `Error` objects or untyped.

Cons:

- Inconsistent log structure; no shared requestId/traceId fields.
- Secrets leak because redaction is not enforced.
- Error shapes vary across API responses.
- Impossible to enforce log hygiene at platform boundary.

### Option B: Cloud-native observability suite (Datadog, Grafana Cloud agent, AWS X-Ray)

Pros:

- Managed dashboards.

Cons:

- Vendor lock-in before product requirements are known.
- Cost at skeleton/development stage.
- Does not address local development tracing.
- Can be adopted later through OTel exporters without changing this ADR.

### Option C: OpenTelemetry + Pino + typed platform abstractions (chosen)

OpenTelemetry for traces and metrics (vendor-neutral), Pino for structured JSON logs, typed platform packages for runtime context and error primitives.

Pros:

- Vendor-neutral: export to any backend (Jaeger, Grafana Tempo, Datadog, Honeycomb) by swapping the OTel exporter.
- Pino is the fastest structured JSON logger for Node; redaction is first-class.
- Typed error primitives enforce safe API responses without per-route handling.
- Local Compose OTel collector accepts OTLP immediately (ADR-0017).

Cons:

- Requires creating internal platform packages before the first slice.

## Decision

---

### 1. Observability standard ? OpenTelemetry

```text
@opentelemetry/api             (API surface ? imported by platform-observability)
@opentelemetry/sdk-node        (Node SDK ? used by adapters-opentelemetry)
@opentelemetry/exporter-otlp-* (OTLP exporter ? configured by adapters-opentelemetry)
```

Rules:

- All traces use W3C trace context propagation (`traceparent` / `tracestate` headers).
- Browser-to-BFF calls must forward `traceparent` where the browser initiates a traced operation.
- Node BFF creates or continues the incoming request span.
- Use cases create child spans scoped to the operation name.
- Adapters create child spans around external I/O (database, cache, queue, email, storage).
- Domain packages must not import `@opentelemetry/api` or any OTel SDK directly. Instrumentation goes through `packages/platform-observability` abstractions.
- The local Compose OTel collector (`localhost:4317` / `localhost:4318`, ADR-0017) is the default OTLP endpoint for development.

---

### 2. Structured logging ? Pino + `packages/platform-logging`

```text
pino  (Node BFF and adapter logging)
```

Create `packages/platform-logging`. It must provide:

- `createLogger(options)` ? returns a scoped Pino logger
- `createChildLogger(parent, fields)` ? returns a child logger with additional bound fields
- `createRequestLogger(req, context)` ? request-scoped logger with `requestId`, `traceId`, `spanId`
- `redactionConfig` ? exported redaction paths configuration
- `createBrowserLogger(options)` ? browser-safe logger (no console.log fallthrough; no sensitive fields)
- Safe metadata helpers: `safeErrorMeta(err)`, `safeContextMeta(ctx)`

Required log fields (structured JSON, Node runtime):

| Field            | Source             | Required            |
| ---------------- | ------------------ | ------------------- |
| `level`          | Pino level         | Yes                 |
| `time`           | ISO timestamp      | Yes                 |
| `requestId`      | Request context    | When available      |
| `traceId`        | OTel trace context | When available      |
| `spanId`         | OTel span context  | When available      |
| `packageName`    | Logger scope       | Yes                 |
| `boundedContext` | Logger scope       | Yes                 |
| `operation`      | Log site           | Recommended         |
| `actorId`        | Runtime context    | When available      |
| `tenantId`       | Runtime context    | When available      |
| `err`            | Error serializer   | When logging errors |

Rules:

- No `console.log` / `console.error` in app runtime, BFF, or adapter code.
- Logs are JSON in Node runtime; human-readable format is acceptable in development via Pino transport.
- `requestId` and `traceId` must be present on all request-scoped log lines.
- Browser logger must not emit sensitive state, full request/response payloads, or auth context.

---

### 3. Redaction policy

Pino's `redact` option is configured at the root logger level in `packages/platform-logging`. The following paths are redacted (replaced with `[REDACTED]`) before any log is emitted:

```text
password
passwordHash
secret
token
accessToken
refreshToken
idToken
apiKey
apiSecret
clientSecret
cookie
cookies
authorization
x-api-key
x-auth-token
x-forwarded-authorization
dsn
connectionString
databaseUrl
DATABASE_URL
SENTRY_DSN
*.password
*.secret
*.token
*.apiKey
req.headers.authorization
req.headers.cookie
res.headers["set-cookie"]
```

Rules:

- Redaction is enforced at the logger level; individual log sites must not rely on selective omission.
- Internal error details (stack traces, SQL queries, upstream error messages) are logged at `debug` level with appropriate redaction; they are never included in API responses.
- The redaction list is versioned in `packages/platform-logging`; additions require a PR review.

---

### 4. Runtime context ? `packages/platform-runtime-context`

Create `packages/platform-runtime-context`. It must define:

```typescript
interface RuntimeContext {
  requestId: string;
  traceId?: string;
  spanId?: string;
  actorId?: string;
  tenantId?: string;
  organisationId?: string;
  correlationId?: string;
  featureName?: string;
  operationName?: string;
}
```

Rules:

- Runtime context flows: BFF request handler ? use case ? adapter.
- Domain logic receives only `{ requestId, traceId, operationName }` if it requires context.
- Do not pass raw HTTP `Request` / `Response` objects into domain or use-case packages.
- React feature hooks receive `requestId` only through contract client helpers; full runtime context is never exposed to the browser.
- `packages/platform-runtime-context` has no `@platform` dependencies; it exports types and factory helpers only.

---

### 5. Error primitives ? `packages/platform-errors`

Create `packages/platform-errors`. It must define:

| Class                 | HTTP status | Retryable | Use case                                                                           |
| --------------------- | ----------- | --------- | ---------------------------------------------------------------------------------- |
| `AppError`            | ?           | Base      | Abstract base with `code`, `safeMessage`, `httpStatus`, `retryable`, `safeDetails` |
| `ValidationError`     | 400         | No        | Input validation failure; safe for client                                          |
| `NotFoundError`       | 404         | No        | Resource not found; safe for client                                                |
| `ConflictError`       | 409         | No        | State conflict (duplicate, version mismatch)                                       |
| `UnauthorizedError`   | 401         | No        | Missing or invalid authentication                                                  |
| `ForbiddenError`      | 403         | No        | Authenticated but not permitted                                                    |
| `InfrastructureError` | 502/503     | Yes       | Downstream service failure; internal only                                          |
| `UnexpectedError`     | 500         | No        | Catch-all; internal details suppressed from client                                 |

Each error class must have:

- `code` ? stable, namespaced string identifier (e.g., `VALIDATION_ERROR`, `NOT_FOUND`)
- `safeMessage` ? message safe to include in API responses
- `httpStatus` ? numeric HTTP status code
- `retryable` ? boolean, populated by subclass default
- `safeDetails` ? optional structured object safe for API responses
- `internalDetails` ? optional object for log-only context; never serialised to response

Rules:

- Use typed platform errors for all expected failure paths.
- Do not throw raw `Error` for validation failures, not-found cases, or conflict conditions.
- API responses must expose `{ code, message, details? }` using `safeMessage` and `safeDetails` only.
- Logs may include `internalDetails` after redaction.
- Domain packages must not import HTTP frameworks or response objects. Throwing `new ValidationError("...")` is permitted in domain/use-case code ? it uses a _semantic error category_, not an HTTP concept.
- `httpStatus` on `AppError` subclasses is **metadata for the API boundary**, not a domain concept. Domain code never reads `httpStatus`; the API boundary reads it once to set the HTTP response status code.
- The API boundary owns the final HTTP response mapping ? it reads `err.httpStatus`, constructs `{ code, message, details? }`, and sets the status. Nothing else does this.
- `UnexpectedError` wraps unknown errors; the wrapped cause is log-only.

---

### 6. Debug and diagnostics policy

Debug namespaces follow the pattern:

```text
platform:<package>:<operation>
feature:<feature>:<operation>
adapter:<adapter>:<operation>
```

Rules:

- Debug output is disabled by default (`DEBUG=""` in production).
- Debug output obeys the same redaction policy as production logs.
- `packages/platform-logging` exposes a `createDebugLogger(namespace)` helper.
- No raw `debug` package imports in feature or adapter packages; use platform helpers.

---

### 7. Health, readiness, and version endpoints

The Node BFF/API runtime must expose the following contracts. Implementation is tracked in ADR-ACT-0104.

**`GET /healthz`** ? process liveness

```text
200 OK
{ "status": "ok" }
```

**`GET /readyz`** ? dependency readiness

```text
200 OK  { "status": "ready", "dependencies": { "database": "ok", "cache": "ok" } }
503 Service Unavailable  { "status": "not-ready", "dependencies": { "database": "failed" } }
```

**`GET /version`** ? build metadata

```text
200 OK
{
  "version": "<semver>",
  "gitSha": "<sha or unknown>",
  "buildTime": "<ISO timestamp or unknown>",
  "environment": "<env name>"
}
```

Rules:

- `/healthz` and `/readyz` must not require authentication.
- `/version` must not expose secrets, connection strings, or internal paths.
- Dependency names in `/readyz` must match service names from the runtime context.

---

### 8. Metric conventions

Metrics are emitted through OpenTelemetry. Prometheus endpoint is deferred unless needed before the first slice.

Required metric names and dimensions:

| Metric                          | Type      | Dimensions                           |
| ------------------------------- | --------- | ------------------------------------ |
| `http.server.request.duration`  | Histogram | `method`, `route`, `status_code`     |
| `http.server.request.count`     | Counter   | `method`, `route`, `status_code`     |
| `http.server.error.count`       | Counter   | `method`, `route`, `error_code`      |
| `adapter.operation.duration`    | Histogram | `adapter`, `operation`               |
| `adapter.operation.error.count` | Counter   | `adapter`, `operation`, `error_code` |
| `usecase.duration`              | Histogram | `feature`, `operation`               |

Rules:

- Metric names follow OpenTelemetry semantic conventions where applicable.
- Cardinality must be bounded ? do not add unbounded dimensions (e.g., userId, entityId).
- Metrics are recorded by the BFF request handler and adapter base classes; features do not record metrics directly.

---

### 9. Sentry integration policy

Sentry remains behind `packages/adapters-sentry`. It is not a direct platform-layer dependency.

Rules:

- Feature packages must not import Sentry.
- Domain packages must not import Sentry.
- `packages/platform-errors` and `packages/platform-observability` may integrate with `packages/adapters-sentry` in the adapter layer only.
- The Compose `sentry` profile is experimental (ADR-ACT-0089); it is not required for ADR-ACT-0008.
- Sentry DSNs must be redacted in all logs.

---

### 10. Package boundaries

**Allowed:**

| Consumer                          | May import                                                                                  |
| --------------------------------- | ------------------------------------------------------------------------------------------- |
| `packages/platform-api`           | `platform-logging`, `platform-observability`, `platform-runtime-context`, `platform-errors` |
| Use-case / application packages   | `platform-runtime-context`, `platform-errors`, `platform-observability` (abstraction only)  |
| Adapter packages                  | `platform-logging`, `platform-observability`, `platform-runtime-context`, `platform-errors` |
| React feature packages            | `platform-errors` safe client types only; contract client helpers for `requestId`           |
| `packages/platform-logging`       | `pino` (Node), browser-safe subset                                                          |
| `packages/platform-observability` | `@opentelemetry/api` only (not SDK)                                                         |

**Forbidden:**

| Consumer              | Must NOT import                                                                       |
| --------------------- | ------------------------------------------------------------------------------------- |
| `packages/domain/*`   | `pino`, `@opentelemetry/api`, `@opentelemetry/sdk-*`, Sentry                          |
| `packages/features/*` | `pino`, Sentry, `packages/adapters-*`                                                 |
| `packages/ui`         | Logging, observability, or error packages (except UI-safe `ErrorState` display types) |
| Any React package     | `@opentelemetry/sdk-node`, `pino` (Node)                                              |

## Rationale

Option C is chosen because:

1. **Vendor neutrality** ? OTel API + OTLP exporter allows swapping backends (Jaeger, Grafana Tempo, Datadog, Honeycomb) by configuration change, not code change. The local Compose OTel collector (ADR-0017) provides immediate local tracing.

2. **Typed error primitives** ? Raw `Error` throws produce inconsistent API responses. Typed error classes with `safeMessage` / `safeDetails` / `internalDetails` enforce the boundary between what the browser sees and what the logs contain.

3. **Redaction at source** ? Pino's `redact` option at the root logger level is the only reliable way to prevent credential leakage. Per-log-site omission is fragile and will miss cases.

4. **Domain isolation** ? Domain packages must not know about Pino, OTel, or Sentry. This is enforced by routing all observability through `packages/platform-logging` and `packages/platform-observability` abstractions, which themselves have no `@platform` dependencies.

5. **W3C trace context** ? `traceparent` is a standard header supported by every modern tracing backend. Using proprietary propagation formats (Datadog `x-datadog-trace-id`, AWS X-Ray `X-Amzn-Trace-Id`) would create vendor lock-in at the protocol level.

## Consequences

**Positive:**

- Distributed tracing from browser request to adapter response is possible from the first slice.
- API responses expose only safe, typed error shapes ? no internal stack traces or connection details.
- Redaction is enforced platform-wide without per-site discipline.
- Local tracing works out of the box with the Compose OTel collector.

**Negative:**

- Four new platform packages must be created before ADR-ACT-0008 (ADR-ACT-0100 through ADR-ACT-0103).
- BFF request handlers must bind runtime context on every request; this is not optional.

**Neutral / operational:**

- Prometheus endpoint is deferred; OTel metrics are emitted to the Compose OTel collector and can be scraped by a Prometheus OTel receiver if added.
- Sentry is deferred at the infrastructure level (Compose profile experimental); the adapter boundary means it can be wired in at any point without touching feature code.
- Health/readiness endpoints are contracted here; implementation is in ADR-ACT-0104.

## AI-assistance record

AI used: Yes

- Tool/model: Claude Sonnet 4.6
- Assistance scope: ADR drafting and library selection analysis
- Human review status: Reviewed by architecture owner
- Evidence checked: `docs/evidence/observability/observability-runtime-baseline.md`
- Validation required: All quality and architecture gates pass before ADR-ACT-0008

## Validation / evidence

Evidence level: High

Evidence file: `docs/evidence/observability/observability-runtime-baseline.md`

All quality and architecture gates pass at commit of this ADR.

## Impacted areas

- Architecture: Package boundary rules extended for platform observability packages.
- Security: Redaction policy defined; Sentry DSN and credential fields protected.
- Operations: Health/readiness/version endpoint contracts defined.
- API: Error shapes standardised across all BFF routes.
- Testing: Platform-logging and platform-errors packages must include unit tests.
- Documentation: `docs/evidence/observability/` category added (ADR-0007 amendment).

## Follow-up actions

Follow-up actions tracked in `docs/adr/ACTION-REGISTER.md`.

## Review date

2026-08-28

## Supersedes

None.

## Superseded by

None.

## References

- ADR-0001: Hexagonal architecture ? adapters own external integrations
- ADR-0017: Local integration substrate ? OTel collector in Compose
- ADR-0019: React component platform ? browser safety requirements
- `docs/evidence/observability/observability-runtime-baseline.md`
- OpenTelemetry: <https://opentelemetry.io>
- Pino: <https://getpino.io>
- W3C Trace Context: <https://www.w3.org/TR/trace-context/>
- OpenTelemetry Semantic Conventions: <https://opentelemetry.io/docs/concepts/semantic-conventions/>

## Notes

`packages/observability` (existing, lifecycle: `active.platform`) is the interface package with zero `@platform` dependencies. `packages/platform-observability` (new) builds on top of this interface and wraps `@opentelemetry/api`. The existing `packages/adapters-opentelemetry` implements the SDK-level wiring and is registered at application startup only.

**Why `packages/observability` must have zero `@platform` dependencies:** It is a leaf port interface ? the stable contract that all observability consumers import. If it depended on `platform-logging` or `platform-observability`, those packages would become transitive dependencies of every domain, feature, and UI package that imports `observability`, violating the import boundary rules (`no-raw-observability-in-domain`, `no-raw-observability-in-feature`). Keeping it dependency-free means: (a) domain and feature packages can import it without pulling in Pino or OTel, and (b) the interface can be implemented by any adapter without circular dependency risk. The `validate-source-imports` tool enforces this via the `no-platform-deps-in-observability` rule.

The `packages/platform-logging` browser logger uses a minimal abstraction over `console` with structured field discipline and redaction enforcement. It does not use Pino in the browser (Pino is Node-only in its full form).

`packages/platform-errors` has no `@platform` dependencies beyond shared type contracts. It is importable by React feature packages for safe client-side error type checks (e.g., checking `err instanceof ValidationError` to display form errors).
