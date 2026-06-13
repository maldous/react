# History / audit / data repository foundation — decision (scoped, not delivered)

**Source ADR:** ADR-0063 (Proposed) · **Capability:** new `history-read-model`
(domain `security-governance` / `data-platform`) · **Status:** scoped — **not delivered**

## Why this is scoped, not built in this pass

A unified, tenant-scoped history read model is genuinely useful, but a naïve
implementation would **duplicate data and overlap an already-delivered
capability**. The foundation already has tenant-scoped, RLS-isolated, append-only
history surfaces:

| Source table | Capability | Existing read surface |
| --- | --- | --- |
| `audit_events` | privileged-access-audit (delivered) | `GET /api/org/audit` |
| `platform_events` + `event_dead_letters` | event-bus-queues-dlq (locally proven) | `GET /api/admin/events` |
| `notification_log` | notifications (locally proven) | (operator readiness; dispatch log) |
| `incidents` | observability-alerting-builtin (locally proven) | `GET /api/admin/incidents` |
| `meter_events` | metering-usage-meters (locally proven) | `GET /api/org/usage` |

Building a second store that copies these rows would violate the registry rule
*"Do not duplicate data unnecessarily"* and the no-fake-readiness discipline.
The correct architecture is a **read-only union view (a query port), never a
copy**, and it must be designed against ADR-0063 (data governance / DSR) so the
history model and the DSR/export model share one lineage definition.

## Decision

Deliver a `HistoryRepositoryPort` as a **read-only projection** over the existing
RLS-scoped tables — no new write path, no duplicated rows — once ADR-0063 is
hardened to decision quality (it is still Proposed). Until then, the existing
per-domain read surfaces above are the history surface.

## Required design (the next slice)

1. **Port:** `HistoryRepositoryPort.query(organisationId, { sources?, cursor, limit })`
   returning a normalised `HistoryEntry { sourceType, sourceId, occurredAt, actor?,
   action, summary }` — **no payload, no secrets** (redacted at the boundary).
2. **Adapter:** a Postgres adapter issuing a `UNION ALL` over the five tables under
   `withTenant` (RLS) for tenant queries and `withSystemAdmin` for the operator
   cross-tenant view, ordered by `occurred_at`, keyset-paginated.
3. **Tenant isolation:** RLS does the work; the operator route takes an explicit
   `tenantId` and is `platform.*`-gated and audited.
4. **Routes (BFF):** `GET /api/org/history` (tenant, own) and
   `GET /api/admin/tenants/:tenantId/history` (operator) — both paginated, with
   OpenAPI entries and contracts in `contracts-admin`.
5. **Redaction:** the projection selects only metadata columns; a regex guard
   (`/secret|password|token|credential|api[_-]?key/i`) rejects any column that
   would carry a secret, matching the dispatch/meter guards.
6. **Retention classification:** history inherits each source table's retention;
   the read model never extends a row's lifetime. Retention enforcement is the
   `pitr-retention-legalhold-residency` capability (Phase 8).

## Proof requirement (for the future slice)

`proof:history-repository` (live Postgres): a tenant sees only its own history;
an operator can query one tenant's history; entries link back to their source
table/type; secret columns are never projected; the query is keyset-paginated;
no provider secrets are exposed. Negative: a second tenant's rows never appear in
tenant A's query.

## Blockers

- **ADR-0063 is Proposed**, not implementation-ready (the USF validator already
  warns on this). The history read model and DSR/export must share one lineage
  model, so ADR-0063 hardening is the gate.
- No data duplication is permitted; the slice is a query projection only.
