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
  tenantId: string;
  action: AuditAction | string;
  resource: string;
  resourceId: string;
  metadata?: Record<string, unknown>;
  timestamp: string;
  ipAddress?: string;
  userAgent?: string;
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
