import { z } from "zod";
import pg from "pg";
import { AuditAction, createAuditEvent, type AuditEventPort } from "@platform/audit-events";
import { NotFoundError, ValidationError } from "@platform/platform-errors";
import { withTenant, withSystemAdmin } from "@platform/adapters-postgres";
import type { TenantRole } from "@platform/domain-identity";

// ---------------------------------------------------------------------------
// Member management usecases (ADR-ACT-0143 Slice 1)
//
// All mutations follow the audit-first pattern (ADR-ACT-0154):
//   1. Validate input          — return early on invalid; no side-effects
//   2. Check pre-conditions    — throw NotFoundError if resource is absent
//   3. Emit audit event        — if this throws, mutation does not run
//   4. Execute DB mutation     — only if audit succeeded
//
// Membership rows live in public.memberships (public schema, RLS-enforced).
// withTenant() sets app.current_tenant_id so RLS passes for platform_app.
// User existence lookups use withSystemAdmin() (cross-tenant, bypass RLS).
// pending_invitations live in public schema with no RLS — direct pool query.
// ---------------------------------------------------------------------------

export interface MembersDeps {
  audit: AuditEventPort;
  pool: pg.Pool;
}

// ---------------------------------------------------------------------------
// listOrgMembers — read-only, no audit required
// ---------------------------------------------------------------------------

export interface MemberRow {
  userId: string;
  email: string;
  displayName: string;
  role: TenantRole;
  joinedAt: string;
}

export interface PendingInvitationRow {
  email: string;
  role: TenantRole;
  invitedAt: string;
  expiresAt: string;
}

export interface ListMembersResult {
  members: MemberRow[];
  pendingInvitations: PendingInvitationRow[];
}

export async function listOrgMembers(
  organisationId: string,
  pool: pg.Pool
): Promise<ListMembersResult> {
  const members = await withTenant(pool, organisationId, async (client) => {
    const { rows } = await client.query<{
      user_id: string;
      email: string;
      display_name: string;
      role: TenantRole;
      created_at: Date;
    }>(
      `SELECT m.user_id, u.email, u.display_name, m.role, m.created_at
       FROM memberships m
       JOIN users u ON m.user_id = u.id
       WHERE m.organisation_id = $1
       ORDER BY m.created_at ASC`,
      [organisationId]
    );
    return rows.map((r) => ({
      userId: r.user_id,
      email: r.email,
      displayName: r.display_name,
      role: r.role,
      joinedAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
    }));
  });

  const { rows: invRows } = await pool.query<{
    email: string;
    role: TenantRole;
    created_at: Date;
    expires_at: Date;
  }>(
    `SELECT email, role, created_at, expires_at
     FROM public.pending_invitations
     WHERE organisation_id = $1
       AND consumed_at IS NULL
       AND expires_at > now()
     ORDER BY created_at ASC`,
    [organisationId]
  );

  return {
    members,
    pendingInvitations: invRows.map((r) => ({
      email: r.email,
      role: r.role,
      invitedAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
      expiresAt: r.expires_at instanceof Date ? r.expires_at.toISOString() : String(r.expires_at),
    })),
  };
}

// ---------------------------------------------------------------------------
// inviteOrgMember — create invitation or direct membership
// ---------------------------------------------------------------------------

export const InviteMemberSchema = z.object({
  email: z.string().email("email must be a valid email address"),
  role: z.enum(["tenant-admin", "manager", "member", "viewer"]),
});

export type InviteMemberBody = z.infer<typeof InviteMemberSchema>;

export type InviteOrgMemberResult = { kind: "invited" } | { kind: "added" } | { kind: "conflict" };

export async function inviteOrgMember(
  input: {
    rawBody: unknown;
    organisationId: string;
    actorId: string;
    actorRoles: string[];
  },
  deps: MembersDeps
): Promise<InviteOrgMemberResult | { kind: "invalid_body"; message: string }> {
  const parsed = InviteMemberSchema.safeParse(input.rawBody);
  if (!parsed.success) {
    return { kind: "invalid_body", message: parsed.error.issues[0]?.message ?? "Invalid body" };
  }
  const { email, role } = parsed.data;

  // Audit before any DB write
  await deps.audit.emit(
    createAuditEvent({
      actorId: input.actorId,
      actorRoles: input.actorRoles,
      tenantId: input.organisationId,
      action: AuditAction.MemberInvited,
      resource: "organisation:members",
      resourceId: email,
      metadata: { email, role },
    })
  );

  // Check if user already exists (cross-tenant lookup)
  const existingUser = await withSystemAdmin(deps.pool, async (client) => {
    const { rows } = await client.query<{ id: string }>(
      "SELECT id FROM public.users WHERE email = $1 LIMIT 1",
      [email]
    );
    return rows[0] ?? null;
  });

  if (existingUser) {
    // User exists — create membership directly
    const inserted = await withTenant(deps.pool, input.organisationId, async (client) => {
      const { rowCount } = await client.query(
        `INSERT INTO memberships (user_id, organisation_id, role)
         VALUES ($1, $2, $3)
         ON CONFLICT (user_id, organisation_id) DO NOTHING`,
        [existingUser.id, input.organisationId, role]
      );
      return (rowCount ?? 0) > 0;
    });
    return inserted ? { kind: "added" } : { kind: "conflict" };
  }

  // User not yet registered — create pending invitation (JIT on first login)
  await deps.pool.query(
    `INSERT INTO public.pending_invitations (email, organisation_id, role)
     VALUES ($1, $2, $3)`,
    [email, input.organisationId, role]
  );
  return { kind: "invited" };
}

// ---------------------------------------------------------------------------
// updateMemberRole — change an existing member's role
// ---------------------------------------------------------------------------

export const UpdateMemberRoleSchema = z.object({
  role: z.enum(["tenant-admin", "manager", "member", "viewer"]),
});

export async function updateMemberRole(
  input: {
    organisationId: string;
    targetUserId: string;
    actorId: string;
    actorRoles: string[];
    rawBody: unknown;
  },
  deps: MembersDeps
): Promise<{ kind: "ok" } | { kind: "invalid_body"; message: string }> {
  const parsed = UpdateMemberRoleSchema.safeParse(input.rawBody);
  if (!parsed.success) {
    return { kind: "invalid_body", message: parsed.error.issues[0]?.message ?? "Invalid body" };
  }
  const { role: newRole } = parsed.data;

  // Verify membership exists before auditing
  const exists = await withTenant(deps.pool, input.organisationId, async (client) => {
    const { rows } = await client.query(
      "SELECT id FROM memberships WHERE user_id = $1 AND organisation_id = $2 LIMIT 1",
      [input.targetUserId, input.organisationId]
    );
    return rows.length > 0;
  });
  if (!exists) throw new NotFoundError("api.error.memberNotFound");

  await deps.audit.emit(
    createAuditEvent({
      actorId: input.actorId,
      actorRoles: input.actorRoles,
      tenantId: input.organisationId,
      action: AuditAction.MemberRoleChanged,
      resource: "organisation:members",
      resourceId: input.targetUserId,
      metadata: { newRole },
    })
  );

  await withTenant(deps.pool, input.organisationId, async (client) => {
    await client.query(
      `UPDATE memberships SET role = $1, updated_at = now()
       WHERE user_id = $2 AND organisation_id = $3`,
      [newRole, input.targetUserId, input.organisationId]
    );
  });

  return { kind: "ok" };
}

// ---------------------------------------------------------------------------
// removeMember — remove a membership record
// ---------------------------------------------------------------------------

export async function removeMember(
  input: {
    organisationId: string;
    targetUserId: string;
    actorId: string;
    actorRoles: string[];
  },
  deps: MembersDeps
): Promise<void> {
  const exists = await withTenant(deps.pool, input.organisationId, async (client) => {
    const { rows } = await client.query(
      "SELECT id FROM memberships WHERE user_id = $1 AND organisation_id = $2 LIMIT 1",
      [input.targetUserId, input.organisationId]
    );
    return rows.length > 0;
  });
  if (!exists) throw new NotFoundError("api.error.memberNotFound");

  await deps.audit.emit(
    createAuditEvent({
      actorId: input.actorId,
      actorRoles: input.actorRoles,
      tenantId: input.organisationId,
      action: AuditAction.MemberRemoved,
      resource: "organisation:members",
      resourceId: input.targetUserId,
      metadata: {},
    })
  );

  await withTenant(deps.pool, input.organisationId, async (client) => {
    await client.query("DELETE FROM memberships WHERE user_id = $1 AND organisation_id = $2", [
      input.targetUserId,
      input.organisationId,
    ]);
  });
}

// Re-export for ValidationError usage in routes
export { ValidationError };
