# Phase 5.5 — scheduled jobs on the event substrate (delivery evidence)

- **Action:** ADR-ACT-0262 — governing ADR: ADR-0059 (workflow/event/queue, **Accepted** Phase 5). Scheduled jobs build on the proven Phase-5 outbox; the **workflow engine** (Windmill/Temporal) remains a later decision (NOT delivered).
- **Date:** 2026-06-13
- **Status of this document:** delivery evidence. The Universal Service Foundation is **not** complete. Phase 5.5 is built-in scheduled jobs only; no workflow engine, cron expressions, or running scheduler daemon is delivered.

## Proof classification

**Live-proven** against the local Compose Postgres (real RLS):

- `proof:scheduled-jobs` — a schedule persists; a **due job enqueues an event** onto the Phase-5 outbox (tenant id preserved); **idempotency per due-window** prevents a duplicate enqueue when the tick re-runs in the same window (exactly one event); a **paused job does not enqueue**; **run-now** enqueues; **RLS** isolates jobs per tenant; no secret-bearing columns.
- `proof:scheduled-job-routes` — invokes the **real route handlers**: operator creates a schedule; lists it; run-now enqueues; pause toggles `enabled`; missing `organisationId` rejected; invalid ids rejected; access-control metadata (global + `platform.jobs.read/write`).

In-memory `node:test` suite (`scheduled-jobs`, 5 cases) covers persist, due-enqueue, paused-skip, same-window idempotency, and run-now.

## Delivered

1. **Model** — `scheduled_jobs` (migration 030, RLS): `job_key` + `event_type` + `interval_seconds` + `enabled` + `next_run_at` + `last_run_at`.
2. **Port + adapter** — `ScheduledJobRepository` + `PostgresScheduledJobRepository` (tenant reads via `withTenant`; operator + cross-tenant due-scan + `markRun`/`setEnabled` via `withSystemAdmin`; `make_interval` for `next_run_at`).
3. **Usecase** — `setScheduledJob` (audited `scheduled_job.set`), `listScheduledJobs`, `runDueJobs` (enqueues each due job's event onto the Phase-5 `EventBusPort` with an **idempotency key = job + due-window bucket**, then advances `next_run_at`; paused jobs are not due), `runScheduledJobNow` (audited `scheduled_job.run`), `setScheduledJobEnabled` (pause/resume, audited).
4. **Routes** (+ OpenAPI): `GET/POST /api/admin/scheduled-jobs`, `POST /api/admin/scheduled-jobs/:jobId/run`, `PATCH /api/admin/scheduled-jobs/:jobId` (operator-only).
5. **Permissions** — `platform.jobs.read|write` (operator-only) in `domain-identity`.
6. **UI** — `/admin/scheduled-jobs`: per-tenant jobs + create + run-now + pause/resume. Operator-only; React renders BFF state only.
7. **Contracts** — scheduled-job schemas in `@platform/contracts-admin`; `scheduled_job` audit resource + `scheduled_job.set`/`scheduled_job.run` actions.

## Enforced invariants (proven)

Jobs tenant-isolated (RLS); a due job enqueues onto the durable outbox preserving tenant id; **idempotent per due window** (a racing/double tick does not double-enqueue — reuses the Phase-5 event-bus idempotency); paused jobs never enqueue; schedule + run + pause/resume audited; operator routes global-scoped; no secret payload fields; reuses the proven event substrate + worker runtime.

## Still NOT delivered (explicitly)

- **Workflow engine** (Windmill / Temporal) — still a later decision; scheduled jobs are the prerequisite, now in place.
- **Cron expressions** — fixed `interval_seconds` only (no calendar scheduling yet).
- **A running scheduler daemon** — `runDueJobs` is an invocable tick; wiring it to a periodic loop / the worker runtime is the next increment.

## Governance

- Built on the already-Accepted **ADR-0059** (no ADR status change). New row **ADR-ACT-0262**.
- Registry: new **`scheduled-jobs-builtin`** → **locally proven**; **`workflow-engine-scheduled-jobs`** → **partial** (scheduled jobs delivered; workflow engine + cron + daemon deferred). Validator + matrix re-rendered (57 capabilities).

## Commands run (green)

`npm run usf:validate`, `lint:md`, `test:architecture`, `tsc:check`, `openapi:drift`, `frontend:conventions`, `semgrep:gate`, `test:platform-api`, `test:frontend:run`, all prior proofs, `proof:scheduled-jobs` (live), `proof:scheduled-job-routes` (live), `audit:osv`, `audit:deps`, `make check`.
