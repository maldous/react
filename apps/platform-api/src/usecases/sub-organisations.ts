import { z } from "zod";
import pg from "pg";
import { AuditAction, createAuditEvent, type AuditEventPort } from "@platform/audit-events";
import { isSlugReserved } from "@platform/domain-identity";

// ---------------------------------------------------------------------------
// Sub-organisation usecase (ADR-ACT-0143 Slice 3)
//
// Sub-orgs are Tier 2: they share the parent's Keycloak realm and Postgres
// schema. They are rows in public.organisations with parent_id set.
//
// Security: parentOrgId must equal the FQDN-resolved organisationId so a
// tenant admin can only manage their own sub-orgs.
//
// organisations has no RLS; isolation is enforced by explicit WHERE clauses
// filtering on parent_id = $parentOrgId.
//
// Mutation ordering (ADR-ACT-0154 audit-first):
//   1. Validate input
//   2. Pre-condition check (pure read)
//   3. Emit audit event — failure aborts mutation
//   4. Execute DB mutation
// ---------------------------------------------------------------------------

export interface SubOrgsDeps {
  audit: AuditEventPort;
  pool: pg.Pool;
}

export interface SubOrgRow {
  id: string;
  slug: string;
  displayName: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

function rowToSubOrg(r: {
  id: string;
  slug: string;
  display_name: string;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}): SubOrgRow {
  return {
    id: r.id,
    slug: r.slug,
    displayName: r.display_name,
    isActive: r.is_active,
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
    updatedAt: r.updated_at instanceof Date ? r.updated_at.toISOString() : String(r.updated_at),
  };
}

export const CreateSubOrgSchema = z.object({
  slug: z
    .string()
    .min(2, "slug must be at least 2 characters")
    .max(63, "slug must not exceed 63 characters")
    .regex(/^[a-z0-9-]+$/, "slug must contain only lowercase letters, digits, and hyphens")
    .refine(
      (s) => !s.startsWith("-") && !s.endsWith("-"),
      "slug must not start or end with a hyphen"
    ),
  displayName: z.string().min(2, "displayName must be at least 2 characters").max(120),
});

export const UpdateSubOrgSchema = z.object({
  displayName: z.string().min(2).max(120).optional(),
});

export type CreateSubOrgResult =
  | { kind: "ok"; subOrg: SubOrgRow }
  | { kind: "invalid_body"; message: string }
  | { kind: "conflict" }
  | { kind: "reserved_slug" };

export type UpdateSubOrgResult =
  | { kind: "ok"; subOrg: SubOrgRow }
  | { kind: "invalid_body"; message: string }
  | { kind: "not_found" };

export type DeactivateSubOrgResult = { kind: "ok" } | { kind: "not_found" };

// ---------------------------------------------------------------------------
// listSubOrgs
// ---------------------------------------------------------------------------

export async function listSubOrgs(parentOrgId: string, pool: pg.Pool): Promise<SubOrgRow[]> {
  const { rows } = await pool.query<{
    id: string;
    slug: string;
    display_name: string;
    is_active: boolean;
    created_at: Date;
    updated_at: Date;
  }>(
    `SELECT id, slug, display_name, is_active, created_at, updated_at
     FROM public.organisations
     WHERE parent_id = $1
     ORDER BY created_at ASC`,
    [parentOrgId]
  );
  return rows.map(rowToSubOrg);
}

// ---------------------------------------------------------------------------
// createSubOrg
// ---------------------------------------------------------------------------

export async function createSubOrg(
  input: {
    rawBody: unknown;
    parentOrgId: string;
    actorId: string;
    actorRoles: string[];
  },
  deps: SubOrgsDeps
): Promise<CreateSubOrgResult> {
  const parsed = CreateSubOrgSchema.safeParse(input.rawBody);
  if (!parsed.success) {
    return { kind: "invalid_body", message: parsed.error.issues[0]?.message ?? "Invalid body" };
  }
  const { slug, displayName } = parsed.data;

  if (isSlugReserved(slug)) return { kind: "reserved_slug" };

  // Pre-audit slug uniqueness check (global — slugs are unique across all orgs)
  const { rows: existing } = await deps.pool.query(
    "SELECT id FROM public.organisations WHERE slug = $1 LIMIT 1",
    [slug]
  );
  if (existing.length > 0) return { kind: "conflict" };

  await deps.audit.emit(
    createAuditEvent({
      actorId: input.actorId,
      actorRoles: input.actorRoles,
      tenantId: input.parentOrgId,
      action: AuditAction.SubOrganisationCreated,
      resource: "organisation:sub-organisations",
      resourceId: slug,
      metadata: { slug, displayName, parentOrgId: input.parentOrgId },
    })
  );

  const { rows } = await deps.pool.query<{
    id: string;
    slug: string;
    display_name: string;
    is_active: boolean;
    created_at: Date;
    updated_at: Date;
  }>(
    `INSERT INTO public.organisations (slug, display_name, parent_id, is_active)
     VALUES ($1, $2, $3, true)
     RETURNING id, slug, display_name, is_active, created_at, updated_at`,
    [slug, displayName, input.parentOrgId]
  );
  return { kind: "ok", subOrg: rowToSubOrg(rows[0]!) };
}

// ---------------------------------------------------------------------------
// updateSubOrg
// ---------------------------------------------------------------------------

export async function updateSubOrg(
  input: {
    rawBody: unknown;
    subOrgId: string;
    parentOrgId: string;
    actorId: string;
    actorRoles: string[];
  },
  deps: SubOrgsDeps
): Promise<UpdateSubOrgResult> {
  const parsed = UpdateSubOrgSchema.safeParse(input.rawBody);
  if (!parsed.success) {
    return { kind: "invalid_body", message: parsed.error.issues[0]?.message ?? "Invalid body" };
  }
  if (!parsed.data.displayName) {
    return { kind: "invalid_body", message: "At least one field (displayName) is required" };
  }
  const { displayName } = parsed.data;

  // Verify sub-org exists and belongs to this parent
  const { rows: existing } = await deps.pool.query<{
    id: string;
    slug: string;
    display_name: string;
    is_active: boolean;
    created_at: Date;
    updated_at: Date;
  }>(
    "SELECT id, slug, display_name, is_active, created_at, updated_at FROM public.organisations WHERE id = $1 AND parent_id = $2 LIMIT 1",
    [input.subOrgId, input.parentOrgId]
  );
  if (existing.length === 0) return { kind: "not_found" };

  await deps.audit.emit(
    createAuditEvent({
      actorId: input.actorId,
      actorRoles: input.actorRoles,
      tenantId: input.parentOrgId,
      action: AuditAction.SubOrganisationUpdated,
      resource: "organisation:sub-organisations",
      resourceId: input.subOrgId,
      metadata: { subOrgId: input.subOrgId, displayName },
    })
  );

  const { rows } = await deps.pool.query<{
    id: string;
    slug: string;
    display_name: string;
    is_active: boolean;
    created_at: Date;
    updated_at: Date;
  }>(
    `UPDATE public.organisations SET display_name = $1, updated_at = now()
     WHERE id = $2 AND parent_id = $3
     RETURNING id, slug, display_name, is_active, created_at, updated_at`,
    [displayName, input.subOrgId, input.parentOrgId]
  );
  return { kind: "ok", subOrg: rowToSubOrg(rows[0]!) };
}

// ---------------------------------------------------------------------------
// deactivateSubOrg (soft-delete)
// ---------------------------------------------------------------------------

export async function deactivateSubOrg(
  input: {
    subOrgId: string;
    parentOrgId: string;
    actorId: string;
    actorRoles: string[];
  },
  deps: SubOrgsDeps
): Promise<DeactivateSubOrgResult> {
  const { rows } = await deps.pool.query(
    "SELECT id FROM public.organisations WHERE id = $1 AND parent_id = $2 LIMIT 1",
    [input.subOrgId, input.parentOrgId]
  );
  if (rows.length === 0) return { kind: "not_found" };

  await deps.audit.emit(
    createAuditEvent({
      actorId: input.actorId,
      actorRoles: input.actorRoles,
      tenantId: input.parentOrgId,
      action: AuditAction.SubOrganisationDeactivated,
      resource: "organisation:sub-organisations",
      resourceId: input.subOrgId,
      metadata: { subOrgId: input.subOrgId },
    })
  );

  await deps.pool.query(
    "UPDATE public.organisations SET is_active = false, updated_at = now() WHERE id = $1 AND parent_id = $2",
    [input.subOrgId, input.parentOrgId]
  );
  return { kind: "ok" };
}
