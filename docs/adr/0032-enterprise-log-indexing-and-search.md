# ADR-0032 — Enterprise Log Indexing and Search

**Status:** Accepted  
**Date:** 2026-06-02  
**Deciders:** Architecture owner / technical lead

---

## Context

The platform already emits structured JSON logs from `@platform/platform-logging` (Pino) to stdout.
ADR-0020 requires structured logs with `requestId`, `traceId`, `spanId`, `actorId`, `tenantId`,
`operationName`, and `err` metadata. However, there is no durable, searchable log backend:

- The OTel collector has a logs pipeline but exports only to debug (not durable).
- Sentry is available for exception grouping only; it is not suitable as a primary log store.
- There is no operator UI for searching logs by request ID, trace ID, or tenant.

Without a contained log backend, root cause analysis after production incidents requires SSH access to
container logs, which does not scale and loses history on container restart.

---

## Decision

Use **Grafana Loki + Grafana + Grafana Alloy** as the contained platform logging backend.

```text
Application code
  ↓ Pino structured JSON → stdout
Docker container stdout
  ↓ Alloy (discovers containers, parses JSON, labels)
Loki
  ↓ LogQL queries
Grafana Explore / platform log search API
```

### Why this stack

| Criterion      | Choice                                                       |
| -------------- | ------------------------------------------------------------ |
| App simplicity | Pino stdout — no SDK in feature packages                     |
| Crash safety   | Logs survive app restarts; collector buffers                 |
| Multi-service  | One collector handles Node, Caddy, Redis, Keycloak, Postgres |
| Search UI      | Platform-owned Grafana; no external dependency               |
| Cost           | Self-hosted; no per-GB ingestion charge                      |
| Contained      | All services run in compose; no external accounts required   |

### What is NOT changed

- Application code MUST NOT push directly to Loki, Grafana, Sentry, Datadog, or any external log endpoint.
- `@platform/platform-logging` remains the only logging abstraction allowed in feature packages.
- Sentry is retained for exception grouping (event deduplication, stack traces), not primary log search.

---

## Implementation

### 1. Alloy — log collector

`docker/alloy/config.alloy`

Alloy discovers all containers in the `react-platform` compose project via the Docker socket.
It parses Pino JSON fields and forwards structured logs to Loki.

**Label policy** (critical for Loki performance):

| Category         | Fields                                                                                                                        | Storage                                       |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| Low-cardinality  | `service`, `environment`, `level`                                                                                             | Loki labels (indexed)                         |
| High-cardinality | `requestId`, `traceId`, `actorId`, `tenantId`, `organisationId`, `path`, `operationName`, `status`, `durationMs`, `errorCode` | Structured metadata (searchable, not indexed) |

Putting high-cardinality fields as labels causes index bloat and high memory pressure. They remain
as JSON fields and structured metadata, searchable via `| json | field="value"` LogQL filters.

### 2. Loki — log store

`docker/loki/loki-config.yaml`

- TSDB schema v13, filesystem storage (local dev).
- 30-day retention by default, configurable via `limits_config.retention_period`.
- **Production**: replace filesystem storage with S3/MinIO before accumulating significant volume.

### 3. Grafana — log search UI

`docker/grafana/provisioning/` — Loki datasource auto-provisioned.

`docker/grafana/dashboards/platform-logs-overview.json` — default dashboard:

- Error/warning rates by service
- Slow requests (> 1 s)
- Top failing routes
- Recent fatal/error logs
- Errors by tenant
- Errors by operationName

Grafana is exposed as `/grafana/` via Caddy forward-auth (system-admin only).

### 4. Platform-logging hardening

`@platform/platform-logging`:

- ISO 8601 timestamps (Loki-friendly parsing without extra config).
- String level names (`"info"` not numeric codes) via `formatters.level`.
- Mandatory base fields: `service`, `packageName`, `boundedContext`, `environment`, `version`, `gitSha`.
- Safe error serializers (`err`, `error` → `pino.stdSerializers.err`).
- `normaliseError(err)` utility for operation failure logging.
- `logOperationStart/Success/Failure` lifecycle helpers.
- Browser logger extended with `trace` and `fatal` levels.

### 5. Request correlation in pipeline

`apps/platform-api/src/server/pipeline.ts`:

- `durationMs` on every `http.request.complete` and `http.request.failed` log.
- W3C `traceparent` header extraction → `traceId` and `spanId` in request child logger.
- `route` (matched route template, not raw path) and `operationName` on completion logs.
- `http.request.start` at `debug` level (reduced noise vs previous `info`).
- `http.request.complete` at `info` level with `status` and `durationMs`.
- `http.request.failed` at `error` level with `err`, `status`, `durationMs`.

---

## Consequences

### Positive

- Operators can search logs by `requestId` or `traceId` in Grafana Explore.
- All platform containers (Node, Caddy, Keycloak, Postgres, Redis) are ingested automatically.
- Logs survive container restarts (Loki persistence via Docker volume).
- High-cardinality fields are searchable without index bloat.
- No application-level vendor lock-in.

### Negative / Limitations

- Requires Docker socket access for Alloy in compose (read-only mount).
- Loki filesystem storage must be migrated to S3/MinIO before production scale.
- Grafana basic auth in dev (`admin:admin`); production requires Keycloak SSO integration (future).
- Alloy label cardinality discipline must be maintained — never add `requestId` as a Loki label.

### Deferred

- Loki → S3/MinIO production storage (see `loki-config.yaml` comment).
- Platform admin log search API (`GET /api/admin/logs/search`, `platform.logs.read` permission).
- React admin log search UI.
- Grafana ↔ Keycloak SSO integration (equivalent to pgAdmin/MinIO SSO in ADR-ACT-0183).
- Browser diagnostic ingestion endpoint (`POST /api/diagnostics/browser-log`).

---

## Related ADRs

- ADR-0020: Structured logging requirements (requestId, traceId, redaction, no console.log in runtime).
- ADR-0017: Observability architecture (OTel, Sentry adapter, log collector).
- ADR-ACT-0191–0197: Implementation actions for this ADR.
