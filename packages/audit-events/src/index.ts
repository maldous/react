import { randomUUID } from "node:crypto";

export const packageName = "@platform/audit-events";

export const AuditAction = {
  UserLoggedIn: "user.logged_in",
  UserLoggedOut: "user.logged_out",
  OrganisationUpdated: "organisation.updated",
  MemberInvited: "member.invited",
  MemberRoleChanged: "member.role_changed",
  MemberRemoved: "member.removed",
  ProfileUpdated: "profile.updated",
  ApiKeyCreated: "api_key.created",
  ApiKeyRevoked: "api_key.revoked",
} as const;

export type AuditAction = (typeof AuditAction)[keyof typeof AuditAction];

export interface AuditEvent {
  id: string;
  actorId: string;
  actorRoles?: string[];
  tenantId: string;
  action: AuditAction | string;
  resource: string;
  resourceId: string;
  metadata?: Record<string, unknown>;
  timestamp: string;
  ipAddress?: string;
  userAgent?: string;
  sourceHost?: string;
  correlationId?: string;
}

export interface AuditEventQuery {
  tenantId: string;
  actorId?: string;
  action?: string;
  resource?: string;
  from?: Date;
  to?: Date;
  limit?: number;
}

export interface AuditEventPort {
  emit(event: AuditEvent): Promise<void>;
  query(query: AuditEventQuery): Promise<AuditEvent[]>;
}

export function createAuditEvent(input: Omit<AuditEvent, "id" | "timestamp">): AuditEvent {
  return {
    ...input,
    id: randomUUID(),
    timestamp: new Date().toISOString(),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PgPool = { query(text: string, values?: unknown[]): Promise<{ rows: any[] }> };

export function createPostgresAuditEventPort(pool: PgPool): AuditEventPort {
  return {
    async emit(event: AuditEvent): Promise<void> {
      await pool.query(
        `INSERT INTO public.audit_events
           (id, actor_id, actor_roles, tenant_id, action, resource, resource_id,
            metadata, source_host, correlation_id, timestamp, ip_address, user_agent)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         ON CONFLICT (id) DO NOTHING`,
        [
          event.id,
          event.actorId,
          event.actorRoles ?? [],
          event.tenantId,
          event.action,
          event.resource,
          event.resourceId,
          event.metadata ? JSON.stringify(event.metadata) : null,
          event.sourceHost ?? null,
          event.correlationId ?? null,
          event.timestamp,
          event.ipAddress ?? null,
          event.userAgent ?? null,
        ]
      );
    },
    async query({
      tenantId,
      actorId,
      action,
      resource,
      from,
      to,
      limit = 100,
    }: AuditEventQuery): Promise<AuditEvent[]> {
      const conditions: string[] = ["tenant_id = $1"];
      const params: unknown[] = [tenantId];
      let idx = 2;
      if (actorId) {
        conditions.push(`actor_id = $${idx++}`);
        params.push(actorId);
      }
      if (action) {
        conditions.push(`action = $${idx++}`);
        params.push(action);
      }
      if (resource) {
        conditions.push(`resource = $${idx++}`);
        params.push(resource);
      }
      if (from) {
        conditions.push(`timestamp >= $${idx++}`);
        params.push(from.toISOString());
      }
      if (to) {
        conditions.push(`timestamp <= $${idx++}`);
        params.push(to.toISOString());
      }
      params.push(limit);
      const { rows } = await pool.query(
        `SELECT id, actor_id, actor_roles, tenant_id, action, resource, resource_id,
                metadata, source_host, correlation_id, timestamp, ip_address, user_agent
         FROM public.audit_events
         WHERE ${conditions.join(" AND ")}
         ORDER BY timestamp DESC LIMIT $${idx}`,
        params
      );
      return rows.map((r) => ({
        id: r.id as string,
        actorId: r.actor_id as string,
        actorRoles: r.actor_roles as string[],
        tenantId: r.tenant_id as string,
        action: r.action as string,
        resource: r.resource as string,
        resourceId: r.resource_id as string,
        metadata: r.metadata as Record<string, unknown> | undefined,
        sourceHost: r.source_host as string | undefined,
        correlationId: r.correlation_id as string | undefined,
        timestamp:
          r.timestamp instanceof Date ? r.timestamp.toISOString() : (r.timestamp as string),
        ipAddress: r.ip_address as string | undefined,
        userAgent: r.user_agent as string | undefined,
      }));
    },
  };
}

export function createInMemoryAuditEventPort(): AuditEventPort {
  const events: AuditEvent[] = [];
  return {
    async emit(event) {
      events.push(event);
    },
    async query({ tenantId, actorId, action, resource, from, to, limit = 100 }) {
      return events
        .filter((e) => {
          if (e.tenantId !== tenantId) return false;
          if (actorId && e.actorId !== actorId) return false;
          if (action && e.action !== action) return false;
          if (resource && e.resource !== resource) return false;
          if (from && new Date(e.timestamp) < from) return false;
          if (to && new Date(e.timestamp) > to) return false;
          return true;
        })
        .slice(0, limit);
    },
  };
}
