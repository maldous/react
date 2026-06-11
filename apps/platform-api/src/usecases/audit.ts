import type { AuditEventPort } from "@platform/audit-events";
import type { AuditEventDto } from "@platform/contracts-admin";

// ---------------------------------------------------------------------------
// Contextual audit query (ADR-0040). Tenant-scoped (tenant_id from session, never
// the frontend). The SPA passes a LOGICAL resource; this maps it to the stored
// resource string + the per-context read permission. Metadata is redacted of
// secret-ish keys and ip/userAgent are never exposed.
// ---------------------------------------------------------------------------

const RESOURCE_MAP: Record<string, { stored: string; permission: string }> = {
  member: { stored: "organisation:members", permission: "tenant.members.read" },
  config: { stored: "organisation:config", permission: "tenant.config.read" },
  feature: { stored: "organisation:features", permission: "tenant.features.read" },
  auth_settings: { stored: "auth_settings", permission: "tenant.auth.settings.read" },
};

const SECRET_KEY_RE = /secret|password|token|credential/i;

function redact(metadata?: Record<string, unknown>): Record<string, unknown> | null {
  if (!metadata) return null;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(metadata)) {
    out[k] = SECRET_KEY_RE.test(k) ? "[redacted]" : v;
  }
  return out;
}

export type ListAuditResult =
  | { kind: "ok"; events: AuditEventDto[] }
  | { kind: "forbidden" }
  | { kind: "invalid"; message: string };

export async function listContextualAuditEvents(
  input: {
    organisationId: string;
    actorPermissions: string[];
    resource: string;
    resourceId?: string;
    action?: string;
    actorId?: string;
    from?: Date;
    to?: Date;
    limit?: number;
  },
  deps: { audit: AuditEventPort }
): Promise<ListAuditResult> {
  const mapping = RESOURCE_MAP[input.resource];
  if (!mapping) return { kind: "invalid", message: "Unknown audit resource" };
  // Per-context read permission (route also enforces the coarse tenant.audit.read).
  if (!input.actorPermissions.includes(mapping.permission)) return { kind: "forbidden" };

  const events = await deps.audit.query({
    tenantId: input.organisationId, // authoritative — never from the frontend
    resource: mapping.stored,
    ...(input.resourceId ? { resourceId: input.resourceId } : {}),
    ...(input.action ? { action: input.action } : {}),
    ...(input.actorId ? { actorId: input.actorId } : {}),
    ...(input.from ? { from: input.from } : {}),
    ...(input.to ? { to: input.to } : {}),
    limit: Math.min(Math.max(input.limit ?? 50, 1), 200),
  });

  return {
    kind: "ok",
    events: events.map((e) => ({
      id: e.id,
      action: e.action,
      actorId: e.actorId,
      resource: e.resource,
      resourceId: e.resourceId,
      timestamp: e.timestamp,
      metadata: redact(e.metadata),
    })),
  };
}
