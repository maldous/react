import { z } from "zod";
import pg from "pg";
import { AuditAction, createAuditEvent, type AuditEventPort } from "@platform/audit-events";
import { withTenant, withSystemAdmin } from "@platform/adapters-postgres";
import type { TenantRole } from "@platform/domain-identity";

// ---------------------------------------------------------------------------
// Member management usecases (ADR-ACT-0143 Slice 1, hardened)
//
// All mutations follow the audit-first pattern (ADR-ACT-0154).
// Ordering for mutations with pre-condition checks:
//   1. Validate input          — return result early; no side-effects
//   2. Read pre-conditions     — existence, last-admin count (pure read)
//   3. Emit audit event        — if this throws, mutation does not run
//   4. Execute DB mutation     — only if audit succeeded
//
// Ordering for invite (outcome is determined before auditing):
//   1. Validate input
//   2. Determine outcome (check user+membership existence — pure reads)
//   3. If outcome is conflict/duplicate: return early WITHOUT audit
//   4. Emit audit for the real outcome (invited or added)
//   5. Execute DB write
//
// This satisfies "audit failure aborts mutation" while not emitting
// misleading audit events for no-op conflict paths.
//
// Email normalization: all email addresses are lowercased before DB lookup
// and storage. consumePendingInvitationsForUser uses lower(email) = lower($1)
// for case-insensitive matching (see postgres-identity-repository.ts).
//
// pending_invitations isolation: the table has no RLS (intentional — the JIT
// consume path matches by email with no tenant context). The list query is
// safe because: (a) organisationId comes from FQDN resolution, not user input;
// (b) the WHERE clause always filters on organisation_id; (c) the route is
// scope:"tenant" so it only runs from authenticated tenant FQDN sessions.
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

  // pending_invitations has no RLS — safe because organisationId is always
  // FQDN-derived and the WHERE clause is mandatory.
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
// Flow: validate → determine outcome → audit (only on real write) → mutate
// ---------------------------------------------------------------------------

export const InviteMemberSchema = z.object({
  // Email is normalized to lowercase before all DB operations so JIT consume
  // (case-insensitive match) finds the right invitation regardless of how
  // Keycloak returns the user's email at login time.
  email: z.string().email("email must be a valid email address"),
  role: z.enum(["tenant-admin", "manager", "member", "viewer"]),
});

export type InviteMemberBody = z.infer<typeof InviteMemberSchema>;

export type InviteOrgMemberResult =
  | { kind: "invited" } // new user — pending_invitation created (JIT on first login)
  | { kind: "added" } // existing user — membership created directly
  | { kind: "conflict" } // user already has an active membership in this org
  | { kind: "already_invited" }; // unconsumed pending invitation already exists

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
  const email = parsed.data.email.toLowerCase();
  const { role } = parsed.data;

  // Step 2: Determine outcome before auditing (pure reads).
  const existingUser = await withSystemAdmin(deps.pool, async (client) => {
    const { rows } = await client.query<{ id: string }>(
      "SELECT id FROM public.users WHERE lower(email) = $1 LIMIT 1",
      [email]
    );
    return rows[0] ?? null;
  });

  if (existingUser) {
    // Check if already a member — conflict is a no-op, no audit emitted.
    const alreadyMember = await withTenant(deps.pool, input.organisationId, async (client) => {
      const { rows } = await client.query(
        "SELECT id FROM memberships WHERE user_id = $1 AND organisation_id = $2 LIMIT 1",
        [existingUser.id, input.organisationId]
      );
      return rows.length > 0;
    });
    if (alreadyMember) return { kind: "conflict" };
  } else {
    // Check for an existing unconsumed invitation — duplicate is a no-op.
    const { rows: existing } = await deps.pool.query(
      `SELECT id FROM public.pending_invitations
       WHERE lower(email) = $1 AND organisation_id = $2
         AND consumed_at IS NULL AND expires_at > now()
       LIMIT 1`,
      [email, input.organisationId]
    );
    if (existing.length > 0) return { kind: "already_invited" };
  }

  // Step 3: Audit the real write (invited or added). Failure aborts step 4.
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

  // Step 4: Execute write.
  if (existingUser) {
    await withTenant(deps.pool, input.organisationId, async (client) => {
      await client.query(
        `INSERT INTO memberships (user_id, organisation_id, role) VALUES ($1, $2, $3)`,
        [existingUser.id, input.organisationId, role]
      );
    });
    return { kind: "added" };
  }

  await deps.pool.query(
    `INSERT INTO public.pending_invitations (email, organisation_id, role) VALUES ($1, $2, $3)`,
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

export type UpdateMemberRoleResult =
  | { kind: "ok" }
  | { kind: "invalid_body"; message: string }
  | { kind: "not_found" }
  | { kind: "last_admin_cannot_be_demoted" };

export async function updateMemberRole(
  input: {
    organisationId: string;
    targetUserId: string;
    actorId: string;
    actorRoles: string[];
    rawBody: unknown;
  },
  deps: MembersDeps
): Promise<UpdateMemberRoleResult> {
  const parsed = UpdateMemberRoleSchema.safeParse(input.rawBody);
  if (!parsed.success) {
    return { kind: "invalid_body", message: parsed.error.issues[0]?.message ?? "Invalid body" };
  }
  const { role: newRole } = parsed.data;

  // Fetch existing role and count admins in one withTenant block.
  const check = await withTenant(deps.pool, input.organisationId, async (client) => {
    const { rows: memberRows } = await client.query<{ role: string }>(
      "SELECT role FROM memberships WHERE user_id = $1 AND organisation_id = $2 LIMIT 1",
      [input.targetUserId, input.organisationId]
    );
    if (memberRows.length === 0) return null;
    const currentRole = memberRows[0]!.role as TenantRole;
    // Only count admins if we might be demoting the last one.
    let adminCount = 0;
    if (currentRole === "tenant-admin" && newRole !== "tenant-admin") {
      const { rows: countRows } = await client.query<{ cnt: number }>(
        `SELECT count(*)::int AS cnt FROM memberships
         WHERE organisation_id = $1 AND role = 'tenant-admin'`,
        [input.organisationId]
      );
      adminCount = countRows[0]?.cnt ?? 0;
    }
    return { currentRole, adminCount };
  });

  if (check === null) return { kind: "not_found" };
  if (check.currentRole === "tenant-admin" && newRole !== "tenant-admin" && check.adminCount <= 1) {
    return { kind: "last_admin_cannot_be_demoted" };
  }

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

export type RemoveMemberResult =
  | { kind: "ok" }
  | { kind: "not_found" }
  | { kind: "last_admin_cannot_be_removed" };

export async function removeMember(
  input: {
    organisationId: string;
    targetUserId: string;
    actorId: string;
    actorRoles: string[];
  },
  deps: MembersDeps
): Promise<RemoveMemberResult> {
  // Fetch existing role and admin count in one withTenant block.
  // TOCTOU note: two separate transactions (this read + the delete below)
  // could race if two admins are removed concurrently. Accepted: single-admin
  // orgs are uncommon and the window is tiny; a database-level constraint
  // would require a trigger, which is deferred to a future hardening pass.
  const check = await withTenant(deps.pool, input.organisationId, async (client) => {
    const { rows } = await client.query<{ role: string }>(
      "SELECT role FROM memberships WHERE user_id = $1 AND organisation_id = $2 LIMIT 1",
      [input.targetUserId, input.organisationId]
    );
    if (rows.length === 0) return null;
    const currentRole = rows[0]!.role as TenantRole;
    let adminCount = 0;
    if (currentRole === "tenant-admin") {
      const { rows: countRows } = await client.query<{ cnt: number }>(
        `SELECT count(*)::int AS cnt FROM memberships
         WHERE organisation_id = $1 AND role = 'tenant-admin'`,
        [input.organisationId]
      );
      adminCount = countRows[0]?.cnt ?? 0;
    }
    return { currentRole, adminCount };
  });

  if (check === null) return { kind: "not_found" };
  if (check.currentRole === "tenant-admin" && check.adminCount <= 1) {
    return { kind: "last_admin_cannot_be_removed" };
  }

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

  return { kind: "ok" };
}
