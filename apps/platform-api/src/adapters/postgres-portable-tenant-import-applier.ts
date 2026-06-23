import crypto from "node:crypto";
import type pg from "pg";
import type {
  PortableImportProgress,
  PortableTenantExportEntry,
  PortableTenantImportApplier,
} from "../usecases/data-portability.ts";

type PgClient = pg.PoolClient;

export interface PostgresPortableTenantImportProviderConfig {
  statementTimeoutMs: number;
  retryAttempts: number;
  retryBackoffMs: number;
  configSource: "POSTGRES_APP_URL";
  secretSource: "POSTGRES_APP_URL";
}

interface MemberExport {
  members?: Array<{
    userId?: string;
    email: string;
    displayName?: string;
    username?: string | null;
    role: string;
    status?: string;
  }>;
  pendingInvitations?: Array<{
    email: string;
    role: string;
    invitedAt?: string;
    expiresAt?: string;
  }>;
}

interface DomainExport {
  domain: string;
  source?: string;
  status?: string;
  authClient?: string;
  tls?: string;
  routing?: string;
  canonical?: boolean;
  redirectPolicy?: string;
  createdAt?: string | null;
  verifiedAt?: string | null;
  authClientActivatedAt?: string | null;
  routingLocalProvenAt?: string | null;
  routingPublicProvenAt?: string | null;
  canonicalAt?: string | null;
}

interface HistoryExport {
  entries?: Array<{
    id: string;
    source: string;
    type: string;
    title: string;
    occurredAt: string | null;
    actorId: string | null;
  }>;
}

export function loadPostgresPortableTenantImportProviderConfig(
  env: NodeJS.ProcessEnv = process.env
): PostgresPortableTenantImportProviderConfig {
  return {
    statementTimeoutMs: Number(env["PORTABLE_IMPORT_QUERY_TIMEOUT_MS"] ?? "5000"),
    retryAttempts: Number(env["PORTABLE_IMPORT_RETRY_ATTEMPTS"] ?? "1"),
    retryBackoffMs: Number(env["PORTABLE_IMPORT_RETRY_BACKOFF_MS"] ?? "100"),
    configSource: "POSTGRES_APP_URL",
    secretSource: "POSTGRES_APP_URL",
  };
}

export class PostgresPortableTenantImportApplier implements PortableTenantImportApplier {
  private readonly pool: pg.Pool;
  private readonly organisationId: string;
  private readonly archiveDigest: string;
  private readonly providerConfig: PostgresPortableTenantImportProviderConfig;
  private client: PgClient | null = null;

  constructor(
    pool: pg.Pool,
    organisationId: string,
    archiveDigest: string,
    config: Partial<PostgresPortableTenantImportProviderConfig> = {}
  ) {
    this.pool = pool;
    this.organisationId = organisationId;
    this.archiveDigest = archiveDigest;
    this.providerConfig = {
      ...loadPostgresPortableTenantImportProviderConfig(),
      ...config,
    };
  }

  async beginGroup(): Promise<void> {
    if (this.client) throw new Error("portable import group already open");
    await this.withRetry(async () => {
      const client = await this.pool.connect();
      try {
        await client.query("BEGIN");
        await this.applyQueryTimeout(client);
        this.client = client;
      } catch (err) {
        await client.query("ROLLBACK").catch(() => undefined);
        client.release();
        throw err;
      }
    });
  }

  async applyEntry(entry: PortableTenantExportEntry): Promise<void> {
    const client = this.assertClient();
    if (entry.path === "identity/members.json") {
      await this.applyMembers(client, entry.content as MemberExport);
      return;
    }
    if (entry.path === "config/domains.json") {
      await this.applyDomains(client, entry.content as DomainExport[]);
      return;
    }
    if (entry.path === "audit/history.json") {
      await this.applyHistory(client, entry.content as HistoryExport);
      return;
    }
    throw new Error(`unsupported portable tenant entry: ${entry.path}`);
  }

  async commitGroup(): Promise<void> {
    const client = this.assertClient();
    try {
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw new Error(
        `postgres-portable-tenant-import-applier unavailable during commit; fail-closed with no fallback for archive ${this.archiveDigest}: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    } finally {
      client.release();
      this.client = null;
    }
  }

  async rollbackGroup(): Promise<void> {
    if (!this.client) return;
    await this.client.query("ROLLBACK");
    this.client.release();
    this.client = null;
  }

  async recordProgress(progress: PortableImportProgress): Promise<void> {
    await this.withRetry(async () => {
      const client = await this.pool.connect();
      try {
        await client.query("BEGIN");
        await this.applyQueryTimeout(client);
        await client.query(
          `INSERT INTO public.portable_import_progress
         (organisation_id, archive_digest, completed_orders, failed_order, error, updated_at)
       VALUES ($1, $2, $3, $4, $5, now())
       ON CONFLICT (organisation_id, archive_digest) DO UPDATE SET
         completed_orders = EXCLUDED.completed_orders,
         failed_order = EXCLUDED.failed_order,
         error = EXCLUDED.error,
         updated_at = now()`,
          [
            this.organisationId,
            this.archiveDigest,
            progress.completedOrders,
            progress.failedOrder ?? null,
            progress.error ?? null,
          ]
        );
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw err;
      } finally {
        client.release();
      }
    });
  }

  async healthCheck(): Promise<{
    status: "ready";
    provider: "postgres-portable-tenant-import-applier";
  }> {
    await this.withRetry(async () => {
      const client = await this.pool.connect();
      try {
        await client.query("BEGIN");
        await this.applyQueryTimeout(client);
        await client.query(
          `SELECT 1
             FROM information_schema.tables
            WHERE table_schema = 'public'
              AND table_name IN (
                'portable_import_progress',
                'users',
                'memberships',
                'tenant_domains',
                'audit_events'
              )
            LIMIT 1`
        );
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw err;
      } finally {
        client.release();
      }
    });
    return { status: "ready", provider: "postgres-portable-tenant-import-applier" };
  }

  recoveryAction(): string {
    return "operator recovery: verify POSTGRES_APP_URL secret/config, run migration 044-portable-import-progress.sql and tenant identity/domain/audit migrations, inspect failed portable_import_progress row, then retry the archive import from the last completed order";
  }

  private assertClient(): PgClient {
    if (!this.client) throw new Error("portable import group not open");
    return this.client;
  }

  private async applyMembers(client: PgClient, content: MemberExport): Promise<void> {
    for (const member of content.members ?? []) {
      const user = await client.query<{ id: string }>(
        `INSERT INTO public.users (email, display_name)
         VALUES ($1, $2)
         ON CONFLICT (email) DO UPDATE SET
           display_name = EXCLUDED.display_name,
           updated_at = now()
         RETURNING id`,
        [member.email.toLowerCase(), member.displayName ?? member.email]
      );
      const userId = user.rows[0]!.id;
      await client.query(
        `INSERT INTO public.memberships (user_id, organisation_id, role, username, status)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (user_id, organisation_id) DO UPDATE SET
           role = EXCLUDED.role,
           username = EXCLUDED.username,
           status = EXCLUDED.status,
           updated_at = now()`,
        [
          userId,
          this.organisationId,
          member.role,
          member.username ?? null,
          member.status ?? "active",
        ]
      );
    }

    if ((content.pendingInvitations ?? []).length > 0) {
      await client.query(
        `UPDATE public.pending_invitations
            SET consumed_at = now()
          WHERE organisation_id = $1 AND consumed_at IS NULL`,
        [this.organisationId]
      );
    }
    for (const invite of content.pendingInvitations ?? []) {
      await client.query(
        `INSERT INTO public.pending_invitations
           (email, organisation_id, role, created_at, expires_at)
         VALUES ($1, $2, $3, COALESCE($4::timestamptz, now()), COALESCE($5::timestamptz, now() + interval '72 hours'))`,
        [
          invite.email.toLowerCase(),
          this.organisationId,
          invite.role,
          invite.invitedAt ?? null,
          invite.expiresAt ?? null,
        ]
      );
    }
  }

  private async applyDomains(client: PgClient, domains: DomainExport[]): Promise<void> {
    for (const domain of domains) {
      const result = await client.query(
        `INSERT INTO public.tenant_domains
           (organisation_id, domain, source, ownership_status, auth_client_status,
            routing_status, tls_status, canonical, redirect_policy, created_at, verified_at,
            auth_client_activated_at, routing_local_proven_at, routing_public_proven_at, canonical_at)
         VALUES
           ($1, $2, $3, $4, $5, $6, $7, $8, $9,
            COALESCE($10::timestamptz, now()), $11::timestamptz, $12::timestamptz,
            $13::timestamptz, $14::timestamptz, $15::timestamptz)
         ON CONFLICT (domain) WHERE disabled_at IS NULL DO UPDATE SET
           source = EXCLUDED.source,
           ownership_status = EXCLUDED.ownership_status,
           auth_client_status = EXCLUDED.auth_client_status,
           routing_status = EXCLUDED.routing_status,
           tls_status = EXCLUDED.tls_status,
           canonical = EXCLUDED.canonical,
           redirect_policy = EXCLUDED.redirect_policy,
           verified_at = EXCLUDED.verified_at,
           auth_client_activated_at = EXCLUDED.auth_client_activated_at,
           routing_local_proven_at = EXCLUDED.routing_local_proven_at,
           routing_public_proven_at = EXCLUDED.routing_public_proven_at,
           canonical_at = EXCLUDED.canonical_at
         WHERE public.tenant_domains.organisation_id = EXCLUDED.organisation_id`,
        [
          this.organisationId,
          domain.domain.toLowerCase(),
          domain.source ?? "custom",
          domain.status ?? "pending_dns",
          domain.authClient ?? "inactive",
          domain.routing ?? "routing_unknown",
          domain.tls ?? "tls_unknown",
          domain.canonical ?? false,
          domain.redirectPolicy ?? "no_redirect",
          domain.createdAt ?? null,
          domain.verifiedAt ?? null,
          domain.authClientActivatedAt ?? null,
          domain.routingLocalProvenAt ?? null,
          domain.routingPublicProvenAt ?? null,
          domain.canonicalAt ?? null,
        ]
      );
      if ((result.rowCount ?? 0) === 0) {
        throw new Error(`domain belongs to another tenant: ${domain.domain}`);
      }
    }
  }

  private async applyHistory(client: PgClient, history: HistoryExport): Promise<void> {
    for (const entry of history.entries ?? []) {
      await client.query(
        `INSERT INTO public.audit_events
           (id, actor_id, actor_roles, tenant_id, action, resource, resource_id, metadata, timestamp)
         VALUES
           ($1, $2, '{}', $3, $4, $5, $6, $7::jsonb, COALESCE($8::timestamptz, now()))
         ON CONFLICT (id) DO NOTHING`,
        [
          uuidFromHistoryEntry(entry.id),
          entry.actorId ?? "portable-import",
          this.organisationId,
          entry.type,
          `imported:${entry.source}`,
          entry.id,
          JSON.stringify({ title: entry.title, source: entry.source }),
          entry.occurredAt,
        ]
      );
    }
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
      `postgres-portable-tenant-import-applier unavailable; no fallback is allowed for tenant import application, fail-closed after retry attempts: ${
        lastError instanceof Error ? lastError.message : String(lastError)
      }`
    );
  }

  private async applyQueryTimeout(client: PgClient): Promise<void> {
    await client.query("SELECT set_config('statement_timeout', $1, true)", [
      `${this.providerConfig.statementTimeoutMs}ms`,
    ]);
  }
}

function uuidFromHistoryEntry(id: string): string {
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    return id;
  }
  const hash = crypto.createHash("sha256").update(id).digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(
    17,
    20
  )}-${hash.slice(20, 32)}`;
}
