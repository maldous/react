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
type PgClient = {
  query<T = unknown>(
    sql: string,
    values?: unknown[]
  ): Promise<{ rows: T[]; rowCount?: number | null }>;
};

export interface PostgresObservabilityProviderConfig {
  statementTimeoutMs: number;
  retryAttempts: number;
  retryBackoffMs: number;
  configSource: "POSTGRES_APP_URL";
  secretSource: "POSTGRES_APP_URL";
}

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

export function loadPostgresObservabilityProviderConfig(
  env: NodeJS.ProcessEnv = process.env
): PostgresObservabilityProviderConfig {
  return {
    statementTimeoutMs: Number(env["OBSERVABILITY_REPOSITORY_QUERY_TIMEOUT_MS"] ?? "5000"),
    retryAttempts: Number(env["OBSERVABILITY_REPOSITORY_RETRY_ATTEMPTS"] ?? "1"),
    retryBackoffMs: Number(env["OBSERVABILITY_REPOSITORY_RETRY_BACKOFF_MS"] ?? "100"),
    configSource: "POSTGRES_APP_URL",
    secretSource: "POSTGRES_APP_URL",
  };
}

export class PostgresObservabilityRepository
  implements MetricRepository, AlertRepository, IncidentRepository
{
  private readonly pool: PgPool;
  private readonly providerConfig: PostgresObservabilityProviderConfig;

  constructor(pool: PgPool, config: Partial<PostgresObservabilityProviderConfig> = {}) {
    this.pool = pool;
    this.providerConfig = {
      ...loadPostgresObservabilityProviderConfig(),
      ...config,
    };
  }

  // --- MetricRepository ----------------------------------------------------
  async registerSignal(input: RegisterSignalInput): Promise<void> {
    await this.withRetry(() =>
      withTenant(this.pool as never, input.organisationId, async (client: PgClient) => {
        await this.applyQueryTimeout(client);
        await client.query(
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
        );
      })
    );
  }

  private async signals(organisationId: string, operator: boolean): Promise<MetricSignalRecord[]> {
    const q = async (client: PgClient) => {
      await this.applyQueryTimeout(client);
      const r = await client.query<Record<string, unknown>>(
        `SELECT s.signal_key, s.display_name, s.unit, s.kind, s.description,
                  (SELECT value FROM public.metric_samples m
                    WHERE m.organisation_id = s.organisation_id AND m.signal_key = s.signal_key
                    ORDER BY m.observed_at DESC LIMIT 1) AS latest_value
             FROM public.metric_signals s
            WHERE s.organisation_id = $1 ORDER BY s.signal_key`,
        [organisationId]
      );
      return r.rows.map((row) => ({
        signalKey: row["signal_key"] as string,
        displayName: row["display_name"] as string,
        unit: row["unit"] as string,
        kind: row["kind"] as MetricKind,
        description: row["description"] as string,
        latestValue: row["latest_value"] == null ? null : Number(row["latest_value"]),
      }));
    };
    return this.withRetry(() =>
      operator
        ? withSystemAdmin(this.pool as never, q as never)
        : withTenant(this.pool as never, organisationId, q as never)
    );
  }

  listSignals(organisationId: string): Promise<MetricSignalRecord[]> {
    return this.signals(organisationId, false);
  }
  listSignalsAsOperator(organisationId: string): Promise<MetricSignalRecord[]> {
    return this.signals(organisationId, true);
  }

  async recordSample(organisationId: string, signalKey: string, value: number): Promise<void> {
    await this.withRetry(() =>
      withTenant(this.pool as never, organisationId, async (client: PgClient) => {
        await this.applyQueryTimeout(client);
        await client.query(
          `INSERT INTO public.metric_samples (organisation_id, signal_key, value) VALUES ($1, $2, $3)`,
          [organisationId, signalKey, value]
        );
      })
    );
  }

  async latestValue(organisationId: string, signalKey: string): Promise<number | null> {
    return this.withRetry(() =>
      withSystemAdmin(this.pool as never, async (client: PgClient) => {
        await this.applyQueryTimeout(client);
        const r = await client.query<{ value: number }>(
          `SELECT value FROM public.metric_samples
          WHERE organisation_id = $1 AND signal_key = $2 ORDER BY observed_at DESC LIMIT 1`,
          [organisationId, signalKey]
        );
        const row = r.rows[0];
        return row ? Number(row.value) : null;
      })
    );
  }

  async countSignals(): Promise<number> {
    return this.withRetry(() =>
      withSystemAdmin(this.pool as never, async (client: PgClient) => {
        await this.applyQueryTimeout(client);
        const r = await client.query<{ n: string }>(
          "SELECT count(*)::text AS n FROM public.metric_signals"
        );
        return Number(r.rows[0]?.n ?? "0");
      })
    );
  }

  // --- AlertRepository -----------------------------------------------------
  async upsertRule(input: UpsertAlertRuleInput): Promise<void> {
    await this.withRetry(() =>
      withSystemAdmin(this.pool as never, async (client: PgClient) => {
        await this.applyQueryTimeout(client);
        await client.query(
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
        );
      })
    );
  }

  private async rules(organisationId: string, operator: boolean): Promise<AlertRuleRecord[]> {
    const q = async (client: PgClient) => {
      await this.applyQueryTimeout(client);
      const r = await client.query<Record<string, unknown>>(
        `SELECT * FROM public.alert_rules WHERE organisation_id = $1 ORDER BY rule_key`,
        [organisationId]
      );
      return r.rows.map(toRule);
    };
    return this.withRetry(() =>
      operator
        ? withSystemAdmin(this.pool as never, q as never)
        : withTenant(this.pool as never, organisationId, q as never)
    );
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
    return this.withRetry(() =>
      withSystemAdmin(this.pool as never, async (client: PgClient) => {
        await this.applyQueryTimeout(client);
        const r = await client.query<Record<string, unknown>>(
          `SELECT * FROM public.alert_rules WHERE id = $1`,
          [ruleId]
        );
        const row = r.rows[0];
        return row ? { ...toRule(row), organisationId: row["organisation_id"] as string } : null;
      })
    );
  }

  // --- IncidentRepository --------------------------------------------------
  async open(input: OpenIncidentInput): Promise<IncidentRecord> {
    return this.withRetry(() =>
      withSystemAdmin(this.pool as never, async (client: PgClient) => {
        await this.applyQueryTimeout(client);
        const r = await client.query<Record<string, unknown>>(
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
        return toIncident(r.rows[0]!);
      })
    );
  }

  private async incidents(organisationId: string, operator: boolean): Promise<IncidentRecord[]> {
    const q = async (client: PgClient) => {
      await this.applyQueryTimeout(client);
      const r = await client.query<Record<string, unknown>>(
        `SELECT * FROM public.incidents WHERE organisation_id = $1 ORDER BY opened_at DESC`,
        [organisationId]
      );
      return r.rows.map(toIncident);
    };
    return this.withRetry(() =>
      operator
        ? withSystemAdmin(this.pool as never, q as never)
        : withTenant(this.pool as never, organisationId, q as never)
    );
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
    return this.withRetry(() =>
      withSystemAdmin(this.pool as never, async (client: PgClient) => {
        await this.applyQueryTimeout(client);
        const r = await client.query<Record<string, unknown>>(
          `SELECT * FROM public.incidents WHERE id = $1`,
          [incidentId]
        );
        const row = r.rows[0];
        return row
          ? { ...toIncident(row), organisationId: row["organisation_id"] as string }
          : null;
      })
    );
  }

  async updateStatus(
    incidentId: string,
    status: IncidentStatus,
    updatedBy: string
  ): Promise<IncidentRecord | null> {
    const tsCol = STATUS_TIMESTAMP[status];
    return this.withRetry(() =>
      withSystemAdmin(this.pool as never, async (client: PgClient) => {
        await this.applyQueryTimeout(client);
        const r = await client.query<Record<string, unknown>>(
          `UPDATE public.incidents
            SET status = $2, updated_by = $3,
                ${tsCol} = COALESCE(${tsCol}, now())
          WHERE id = $1 RETURNING *`,
          [incidentId, status, updatedBy]
        );
        const row = r.rows[0];
        return row ? toIncident(row) : null;
      })
    );
  }

  async countOpen(): Promise<number> {
    return this.withRetry(() =>
      withSystemAdmin(this.pool as never, async (client: PgClient) => {
        await this.applyQueryTimeout(client);
        const r = await client.query<{ n: string }>(
          "SELECT count(*)::text AS n FROM public.incidents WHERE status <> 'resolved'"
        );
        return Number(r.rows[0]?.n ?? "0");
      })
    );
  }

  async healthCheck(): Promise<{ status: "ready"; provider: "postgres-observability-repository" }> {
    await this.withRetry(() =>
      withSystemAdmin(this.pool as never, async (client: PgClient) => {
        await this.applyQueryTimeout(client);
        await client.query(
          `SELECT 1
             FROM information_schema.tables
            WHERE table_schema = 'public'
              AND table_name IN ('metric_signals', 'metric_samples', 'alert_rules', 'incidents')
            LIMIT 1`
        );
      })
    );
    return { status: "ready", provider: "postgres-observability-repository" };
  }

  recoveryAction(): string {
    return "operator recovery: verify POSTGRES_APP_URL secret/config, run migration 029-observability-alerts.sql, inspect metric_signals/metric_samples/alert_rules/incidents RLS/grants, then retry metric, alert, or incident operation";
  }

  private async withRetry<T>(operation: () => Promise<T>): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.providerConfig.retryAttempts; attempt += 1) {
      try {
        return await operation();
      } catch (err) {
        lastError = err;
        if (attempt >= this.providerConfig.retryAttempts) break;
        await new Promise((resolve) =>
          setTimeout(resolve, this.providerConfig.retryBackoffMs * (attempt + 1))
        );
      }
    }
    throw new Error(
      `postgres-observability-repository unavailable; no fallback is allowed for metrics, alerts, or incidents, fail-closed after retry attempts: ${
        lastError instanceof Error ? lastError.message : String(lastError)
      }`
    );
  }

  private async applyQueryTimeout(client: PgClient): Promise<void> {
    await client.query(`SET LOCAL statement_timeout = ${this.providerConfig.statementTimeoutMs}`);
  }
}
