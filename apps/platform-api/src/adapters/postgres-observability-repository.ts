/**
 * PostgresObservabilityRepository (ADR-0062 / ADR-ACT-0261).
 *
 * Built-in observability store over metric_signals/metric_samples/alert_rules/incidents
 * (migration 029), RLS-enabled. Implements MetricRepository + AlertRepository +
 * IncidentRepository. Tenant self-reads use withTenant (RLS enforces); operator
 * reads/writes + cross-tenant lookups + sample recording use withSystemAdmin. No secrets.
 */

import { withSystemAdmin, withTenant } from "@platform/adapters-postgres";
import type {
  AlertComparator,
  AlertSeverity,
  IncidentStatus,
  MetricKind,
  NotificationCategory,
} from "@platform/contracts-admin";
import type {
  AlertRepository,
  AlertRuleRecord,
  IncidentRecord,
  IncidentRepository,
  MetricRepository,
  MetricSignalRecord,
  OpenIncidentInput,
  RegisterSignalInput,
  UpsertAlertRuleInput,
} from "../ports/observability-repository.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PgPool = { connect(): Promise<any> };

function iso(v: Date | string | null): string | null {
  if (v == null) return null;
  return typeof v === "string" ? v : v.toISOString();
}

function toRule(r: Record<string, unknown>): AlertRuleRecord {
  return {
    id: r["id"] as string,
    ruleKey: r["rule_key"] as string,
    signalKey: r["signal_key"] as string,
    comparator: r["comparator"] as AlertComparator,
    threshold: Number(r["threshold"]),
    severity: r["severity"] as AlertSeverity,
    enabled: r["enabled"] as boolean,
    notifyUserId: (r["notify_user_id"] as string | null) ?? null,
    notifyCategory: r["notify_category"] as NotificationCategory,
    updatedAt: iso(r["updated_at"] as Date | null),
    updatedBy: (r["updated_by"] as string | null) ?? null,
  };
}

function toIncident(r: Record<string, unknown>): IncidentRecord {
  return {
    id: r["id"] as string,
    ruleKey: r["rule_key"] as string,
    title: r["title"] as string,
    severity: r["severity"] as AlertSeverity,
    status: r["status"] as IncidentStatus,
    observedValue: r["observed_value"] == null ? null : Number(r["observed_value"]),
    threshold: r["threshold"] == null ? null : Number(r["threshold"]),
    openedAt: iso(r["opened_at"] as Date) ?? "",
    acknowledgedAt: iso(r["acknowledged_at"] as Date | null),
    resolvedAt: iso(r["resolved_at"] as Date | null),
  };
}

const STATUS_TIMESTAMP: Record<IncidentStatus, string> = {
  open: "opened_at",
  acknowledged: "acknowledged_at",
  resolved: "resolved_at",
};

export class PostgresObservabilityRepository
  implements MetricRepository, AlertRepository, IncidentRepository
{
  private readonly pool: PgPool;
  constructor(pool: PgPool) {
    this.pool = pool;
  }

  // --- MetricRepository ----------------------------------------------------
  async registerSignal(input: RegisterSignalInput): Promise<void> {
    await withTenant(this.pool as never, input.organisationId, (client) =>
      client.query(
        `INSERT INTO public.metric_signals
           (organisation_id, signal_key, display_name, unit, kind, description)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (organisation_id, signal_key) DO UPDATE SET
           display_name = EXCLUDED.display_name, unit = EXCLUDED.unit,
           kind = EXCLUDED.kind, description = EXCLUDED.description`,
        [
          input.organisationId,
          input.signalKey,
          input.displayName,
          input.unit ?? "",
          input.kind ?? "gauge",
          input.description ?? "",
        ]
      )
    );
  }

  private async signals(organisationId: string, operator: boolean): Promise<MetricSignalRecord[]> {
    const q = (client: {
      query: (t: string, v?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
    }) =>
      client
        .query(
          `SELECT s.signal_key, s.display_name, s.unit, s.kind, s.description,
                  (SELECT value FROM public.metric_samples m
                    WHERE m.organisation_id = s.organisation_id AND m.signal_key = s.signal_key
                    ORDER BY m.observed_at DESC LIMIT 1) AS latest_value
             FROM public.metric_signals s
            WHERE s.organisation_id = $1 ORDER BY s.signal_key`,
          [organisationId]
        )
        .then((r) =>
          r.rows.map((row) => ({
            signalKey: row["signal_key"] as string,
            displayName: row["display_name"] as string,
            unit: row["unit"] as string,
            kind: row["kind"] as MetricKind,
            description: row["description"] as string,
            latestValue: row["latest_value"] == null ? null : Number(row["latest_value"]),
          }))
        );
    return operator
      ? withSystemAdmin(this.pool as never, q as never)
      : withTenant(this.pool as never, organisationId, q as never);
  }

  listSignals(organisationId: string): Promise<MetricSignalRecord[]> {
    return this.signals(organisationId, false);
  }
  listSignalsAsOperator(organisationId: string): Promise<MetricSignalRecord[]> {
    return this.signals(organisationId, true);
  }

  async recordSample(organisationId: string, signalKey: string, value: number): Promise<void> {
    await withTenant(this.pool as never, organisationId, (client) =>
      client.query(
        `INSERT INTO public.metric_samples (organisation_id, signal_key, value) VALUES ($1, $2, $3)`,
        [organisationId, signalKey, value]
      )
    );
  }

  async latestValue(organisationId: string, signalKey: string): Promise<number | null> {
    return withSystemAdmin(this.pool as never, async (client) => {
      const r = await client.query(
        `SELECT value FROM public.metric_samples
          WHERE organisation_id = $1 AND signal_key = $2 ORDER BY observed_at DESC LIMIT 1`,
        [organisationId, signalKey]
      );
      const row = r.rows[0] as { value: number } | undefined;
      return row ? Number(row.value) : null;
    });
  }

  async countSignals(): Promise<number> {
    return withSystemAdmin(this.pool as never, async (client) => {
      const r = await client.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM public.metric_signals"
      );
      return Number(r.rows[0]?.n ?? "0");
    });
  }

  // --- AlertRepository -----------------------------------------------------
  async upsertRule(input: UpsertAlertRuleInput): Promise<void> {
    await withSystemAdmin(this.pool as never, (client) =>
      client.query(
        `INSERT INTO public.alert_rules
           (organisation_id, rule_key, signal_key, comparator, threshold, severity, enabled,
            notify_user_id, notify_category, updated_by, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now())
         ON CONFLICT (organisation_id, rule_key) DO UPDATE SET
           signal_key = EXCLUDED.signal_key, comparator = EXCLUDED.comparator,
           threshold = EXCLUDED.threshold, severity = EXCLUDED.severity,
           enabled = EXCLUDED.enabled, notify_user_id = EXCLUDED.notify_user_id,
           notify_category = EXCLUDED.notify_category, updated_by = EXCLUDED.updated_by,
           updated_at = now()`,
        [
          input.organisationId,
          input.ruleKey,
          input.signalKey,
          input.comparator,
          input.threshold,
          input.severity,
          input.enabled,
          input.notifyUserId ?? null,
          input.notifyCategory,
          input.updatedBy,
        ]
      )
    );
  }

  private async rules(organisationId: string, operator: boolean): Promise<AlertRuleRecord[]> {
    const q = (client: {
      query: (t: string, v?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
    }) =>
      client
        .query(`SELECT * FROM public.alert_rules WHERE organisation_id = $1 ORDER BY rule_key`, [
          organisationId,
        ])
        .then((r) => r.rows.map(toRule));
    return operator
      ? withSystemAdmin(this.pool as never, q as never)
      : withTenant(this.pool as never, organisationId, q as never);
  }
  listRules(organisationId: string): Promise<AlertRuleRecord[]> {
    return this.rules(organisationId, false);
  }
  listRulesAsOperator(organisationId: string): Promise<AlertRuleRecord[]> {
    return this.rules(organisationId, true);
  }

  async findRuleById(
    ruleId: string
  ): Promise<(AlertRuleRecord & { organisationId: string }) | null> {
    return withSystemAdmin(this.pool as never, async (client) => {
      const r = await client.query(`SELECT * FROM public.alert_rules WHERE id = $1`, [ruleId]);
      const row = r.rows[0] as Record<string, unknown> | undefined;
      return row ? { ...toRule(row), organisationId: row["organisation_id"] as string } : null;
    });
  }

  // --- IncidentRepository --------------------------------------------------
  async open(input: OpenIncidentInput): Promise<IncidentRecord> {
    return withSystemAdmin(this.pool as never, async (client) => {
      const r = await client.query(
        `INSERT INTO public.incidents
           (organisation_id, alert_rule_id, rule_key, title, severity, status, observed_value, threshold)
         VALUES ($1,$2,$3,$4,$5,'open',$6,$7) RETURNING *`,
        [
          input.organisationId,
          input.alertRuleId,
          input.ruleKey,
          input.title,
          input.severity,
          input.observedValue,
          input.threshold,
        ]
      );
      return toIncident(r.rows[0] as Record<string, unknown>);
    });
  }

  private async incidents(organisationId: string, operator: boolean): Promise<IncidentRecord[]> {
    const q = (client: {
      query: (t: string, v?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
    }) =>
      client
        .query(
          `SELECT * FROM public.incidents WHERE organisation_id = $1 ORDER BY opened_at DESC`,
          [organisationId]
        )
        .then((r) => r.rows.map(toIncident));
    return operator
      ? withSystemAdmin(this.pool as never, q as never)
      : withTenant(this.pool as never, organisationId, q as never);
  }
  listForTenant(organisationId: string): Promise<IncidentRecord[]> {
    return this.incidents(organisationId, false);
  }
  listForTenantAsOperator(organisationId: string): Promise<IncidentRecord[]> {
    return this.incidents(organisationId, true);
  }

  async findById(
    incidentId: string
  ): Promise<(IncidentRecord & { organisationId: string }) | null> {
    return withSystemAdmin(this.pool as never, async (client) => {
      const r = await client.query(`SELECT * FROM public.incidents WHERE id = $1`, [incidentId]);
      const row = r.rows[0] as Record<string, unknown> | undefined;
      return row ? { ...toIncident(row), organisationId: row["organisation_id"] as string } : null;
    });
  }

  async updateStatus(
    incidentId: string,
    status: IncidentStatus,
    updatedBy: string
  ): Promise<IncidentRecord | null> {
    const tsCol = STATUS_TIMESTAMP[status];
    return withSystemAdmin(this.pool as never, async (client) => {
      const r = await client.query(
        `UPDATE public.incidents
            SET status = $2, updated_by = $3,
                ${tsCol} = COALESCE(${tsCol}, now())
          WHERE id = $1 RETURNING *`,
        [incidentId, status, updatedBy]
      );
      const row = r.rows[0] as Record<string, unknown> | undefined;
      return row ? toIncident(row) : null;
    });
  }

  async countOpen(): Promise<number> {
    return withSystemAdmin(this.pool as never, async (client) => {
      const r = await client.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM public.incidents WHERE status <> 'resolved'"
      );
      return Number(r.rows[0]?.n ?? "0");
    });
  }
}
