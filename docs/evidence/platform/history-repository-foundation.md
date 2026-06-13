# History read-model foundation

**ADR:** ADR-0063 · **Action:** ADR-ACT-0272 · **Status:** Delivered + locally proven
**Capability:** `history-read-model` (data-platform)

## Scope delivered

A **read-only** history projection — `HistoryRepositoryPort` + `PostgresHistoryRepository`
— that UNIONs the existing tenant-scoped sources into one paginated history view, with
**no new store and no duplicated data**. This resolves the data-duplication design gap
recorded in the earlier scoped pass: history is a SELECT-only projection, never a second
copy of the audited/event/notification/incident/meter rows.

Sources unioned:

| Source table | Branch type | Title (safe summary) |
| --- | --- | --- |
| `audit_events` | audit | `action` (+ resource) |
| `platform_events` | event | `event_type [status]` |
| `notification_log` | notification | `channel category [status]` |
| `incidents` | incident | `title` |
| `meter_events` | meter | `meter_key` |

## Design

- **No new store.** A read-only `UNION ALL`; the only new code is a port + adapter +
  usecase + two routes. No migration.
- **Tenant isolation by explicit predicate.** Each branch filters by the organisation
  (`audit_events.tenant_id::text`; the rest `organisation_id::uuid`; the tenant's
  organisationId string satisfies both). The explicit org predicate is the isolation
  guarantee — equivalent to RLS for a read-only projection and immune to the differing
  tenant-column names across sources.
- **Redaction.** Only safe summary columns are projected (`id/source/type/title/
  occurredAt/actorId`). `metadata`/`payload` (which may carry arbitrary content) are
  **never** selected.
- **Pagination required** (`limit` ≤ 200, `offset`), ordered by `occurredAt DESC`.

## Surface

- `GET /api/org/history` — tenant reads its own history (`tenant.audit.read`; org from session).
- `GET /api/admin/tenants/:tenantId/history` — operator reads a selected tenant (`platform.audit.read_all`).
- Query params: `?limit&offset&sources` (`sources` = comma-separated subset of
  audit/event/notification/incident/meter).

## Proof (live)

`proof:history` — 10/10 PASS (live Postgres):

```text
proof:history — 10/10 PASS
```

Asserts: history spans ≥3 source types; total reflects the seeded set; every entry has a
safe summary; **tenant A history excludes tenant B and vice-versa**; **no secret/metadata
content or field-name**; pagination limit caps the page and offset advances; the
projection is **read-only** (source rows unchanged after querying).

## Not delivered

The other ADR-0063 sub-decisions — DSR/GDPR workflows, import/export, classification/PII,
access reviews, compliance evidence packs — remain Proposed (see ADR-0063, hardened under
ADR-ACT-0267). This slice delivers the **read-only history projection only**.

## Linkage

ADR-0063 (hardened) · ADR-ACT-0272 · registry capability `history-read-model` (locally
proven) · projects over `privileged-access-audit`, `event-bus-queues-dlq`, `notifications`,
`observability-alerting-builtin`, `metering-usage-meters`.
