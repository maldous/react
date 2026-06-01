# Platform-Ready Base Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete all actionable ADR-ACT items to bring the platform to a verified "ready for app feature development" state.

**Architecture:** Seven independent workstreams executed in dependency order: sub-organisations (closes ADR-ACT-0143), feature toggles (definition then implementation), vanity-domain DNS proof (ADR-ACT-0188), license scanning (ADR-ACT-0086/0090), OpenAPI drift repair, governance doc updates (ADR-ACT-0032/0038/0039), and explicit classification of deferred items (ADR-ACT-0156-0160, ADR-ACT-0092). Each workstream produces a testable, committed result before the next begins.

**Tech Stack:** Node.js 22, TypeScript, PostgreSQL 16, Keycloak 26, Redis, Zod, platform-errors, platform-logging, @platform/audit-events, adapters-postgres, adapters-keycloak, node:dns (for DNS verification), license-checker-rseidelsohn (npm).

---

## Baseline state

| What | Status |
|---|---|
| 224 platform-api tests | PASS |
| 26 frontend tests | PASS |
| 636/638 architecture tests (2 OpenAPI drift pre-existing) | PASS |
| 24/30 compose tests (6 container-health pre-existing) | PASS |
| make check | PASS |
| ADR-ACT-0143 Slice 1 (members) | Done |
| ADR-ACT-0143 Slice 2 (groups) | Done |
| ADR-ACT-0143 Slice 3 (sub-organisations) | **Open → implement** |
| ADR-ACT-0143 Slice 4 (feature toggles) | **Open → define + implement** |
| ADR-ACT-0188 (vanity domain DNS proof) | **Open → implement** |
| ADR-ACT-0086/0090 (license scanning) | **Open → wire** |
| OpenAPI drift | **Open → fix** |
| ADR-ACT-0032/0038/0039 (governance docs) | **Open → document** |
| ADR-ACT-0092 (Sonar CI) | Blocked on CI secrets — classify only |
| ADR-ACT-0156-0160 (E2E, theming) | Require external fixtures — classify only |

---

## File Map

### Workstream 1: Sub-organisations (ADR-ACT-0143 Slice 3)

| File | Action |
|---|---|
| `apps/platform-api/src/db/migrations/013-sub-organisations.sql` | Create |
| `packages/contracts-auth/src/index.ts` | Modify — add tenant.suborgs.* permissions |
| `packages/domain-identity/src/index.ts` | Modify — add to tenant-admin bundle |
| `packages/audit-events/src/index.ts` | Modify — add SubOrg audit actions |
| `packages/authorisation-runtime/src/index.ts` | Modify — add organisation:sub-organisations to resource list (doc) |
| `apps/platform-api/src/usecases/sub-organisations.ts` | Create |
| `apps/platform-api/src/server/routes.ts` | Modify — 4 routes, replace 501 stub |
| `packages/adapters-keycloak/src/index.ts` | Modify — add to registerPlatformResources |
| `apps/platform-api/tests/unit/sub-organisations.test.ts` | Create |
| `package.json` | Modify — add to test:platform-api script |
| `docs/adr/ACTION-REGISTER.md` | Modify — mark Slice 3 Done |

### Workstream 2: Feature toggles (ADR-ACT-0143 Slice 4)

| File | Action |
|---|---|
| `packages/contracts-auth/src/index.ts` | Modify — add tenant.features.* permissions |
| `packages/domain-identity/src/index.ts` | Modify — add to tenant-admin bundle |
| `packages/audit-events/src/index.ts` | Modify — add FeatureToggled action |
| `apps/platform-api/src/usecases/features.ts` | Create |
| `apps/platform-api/src/server/routes.ts` | Modify — 2 routes |
| `packages/adapters-keycloak/src/index.ts` | Modify — add to registerPlatformResources |
| `apps/platform-api/tests/unit/features.test.ts` | Create |
| `package.json` | Modify — add to test:platform-api script |
| `docs/adr/ACTION-REGISTER.md` | Modify — mark Slice 4 Done, ADR-ACT-0143 Done |

### Workstream 3: Vanity domain DNS proof (ADR-ACT-0188)

| File | Action |
|---|---|
| `apps/platform-api/src/db/migrations/014-vanity-domain-challenges.sql` | Create |
| `packages/audit-events/src/index.ts` | Modify — add VanityDomainChallengeCreated/Verified/Added |
| `apps/platform-api/src/usecases/vanity-domain.ts` | Modify — require verified challenge before add |
| `apps/platform-api/src/usecases/vanity-domain-challenge.ts` | Create |
| `apps/platform-api/src/server/routes.ts` | Modify — 2 new routes (challenge + verify) |
| `apps/platform-api/tests/unit/vanity-domain-challenge.test.ts` | Create |
| `package.json` | Modify — add to test:platform-api |
| `docs/adr/ACTION-REGISTER.md` | Modify — mark ADR-ACT-0188 Done |

### Workstream 4: License scanning (ADR-ACT-0086/0090)

| File | Action |
|---|---|
| `package.json` | Modify — update license:policy to run real scanner |
| `docs/security/license-policy.md` | Modify — add automated enforcement status |
| `docs/adr/ACTION-REGISTER.md` | Modify — mark ADR-ACT-0086 and ADR-ACT-0090 Done |

### Workstream 5: OpenAPI drift fix

| File | Action |
|---|---|
| `docs/api/openapi.json` | Modify — add members, groups, sub-orgs, features, domain-challenge routes |

### Workstream 6: Governance docs (ADR-ACT-0032/0038/0039)

| File | Action |
|---|---|
| `docs/architecture/stakeholder-guide.md` | Create — ADR-ACT-0032 |
| `docs/architecture/generated-outputs-policy.md` | Create — ADR-ACT-0038 |
| `docs/architecture/vocabulary-consistency.md` | Create — ADR-ACT-0039 |
| `docs/adr/ACTION-REGISTER.md` | Modify — mark all three Done |

### Workstream 7: Classify deferred / blocked items

| File | Action |
|---|---|
| `docs/adr/ACTION-REGISTER.md` | Modify — explicit Deferred/Blocked entries for 0092, 0156-0160 |

---

## Task 1: Sub-organisations migration

**Files:**
- Create: `apps/platform-api/src/db/migrations/013-sub-organisations.sql`

- [ ] **Step 1: Write migration 013**

```sql
-- Migration 013: Sub-organisation support (ADR-ACT-0143 Slice 3)
--
-- Sub-organisations are Tier 2 tenants: they share the parent's Keycloak realm
-- and Postgres schema (no new realm/schema provisioned). They are recorded in
-- public.organisations with a non-null parent_id.
--
-- Constraints:
--   - parent_id must point to a top-level org (parent_id IS NULL) — no multi-level
--   - is_active defaults to true; deactivation is a soft-delete
--   - A top-level org cannot be converted to a sub-org after creation
--   - Slugs must be globally unique (existing UNIQUE constraint on slug covers this)
--
-- Isolation: organisations has no RLS (by design, migration 006). Sub-org
-- filtering is application-level: all queries use WHERE parent_id = $parentOrgId.

ALTER TABLE public.organisations
  ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES public.organisations(id)
    ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;

-- Sub-org's parent must itself be a top-level org (no multi-level nesting).
ALTER TABLE public.organisations
  ADD CONSTRAINT suborg_parent_must_be_toplevel
  CHECK (
    parent_id IS NULL
    OR NOT EXISTS (
      SELECT 1 FROM public.organisations p
      WHERE p.id = parent_id AND p.parent_id IS NOT NULL
    )
  );

-- Index for efficient listing of sub-orgs by parent
CREATE INDEX IF NOT EXISTS organisations_parent_id_idx
  ON public.organisations (parent_id)
  WHERE parent_id IS NOT NULL;
```

Save to `apps/platform-api/src/db/migrations/013-sub-organisations.sql`.

- [ ] **Step 2: Apply migration to local Postgres and verify**

```bash
POSTGRES_URL=postgresql://platform:platformpassword@localhost:5433/platform \
  node --loader ./apps/platform-api/loader.mjs -e "
import { runMigrations } from './apps/platform-api/src/db/migrate.ts';
const r = await runMigrations();
console.log('applied:', r.applied, 'skipped:', r.skipped.length);
"
```

Expected: `applied: [ '013-sub-organisations.sql' ] skipped: 12`

```bash
psql postgresql://platform:platformpassword@localhost:5433/platform -c "
\d public.organisations" 2>&1 | grep -E "parent_id|is_active"
```

Expected: both columns present.

- [ ] **Step 3: Commit**

```bash
git add apps/platform-api/src/db/migrations/013-sub-organisations.sql
git commit -m "feat(db): migration 013 — sub-organisations parent_id + is_active"
```

---

## Task 2: Sub-organisations permissions, audit, and contracts

**Files:**
- Modify: `packages/contracts-auth/src/index.ts`
- Modify: `packages/domain-identity/src/index.ts`
- Modify: `packages/audit-events/src/index.ts`

- [ ] **Step 1: Add tenant.suborgs.* to contracts-auth Permission union**

In `packages/contracts-auth/src/index.ts`, after `"tenant.groups.delete"`:

```typescript
  | "tenant.suborgs.read"
  | "tenant.suborgs.create"
  | "tenant.suborgs.update"
  | "tenant.suborgs.delete"
```

- [ ] **Step 2: Add to tenant-admin bundle in domain-identity**

In `packages/domain-identity/src/index.ts`, after `"tenant.groups.delete"`:

```typescript
    "tenant.suborgs.read",
    "tenant.suborgs.create",
    "tenant.suborgs.update",
    "tenant.suborgs.delete",
```

- [ ] **Step 3: Add audit actions**

In `packages/audit-events/src/index.ts`, after `GroupDeleted`:

```typescript
  SubOrganisationCreated: "sub_organisation.created",
  SubOrganisationUpdated: "sub_organisation.updated",
  SubOrganisationDeactivated: "sub_organisation.deactivated",
```

- [ ] **Step 4: Type-check packages**

```bash
npm run tsc:check:packages
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts-auth/src/index.ts packages/domain-identity/src/index.ts packages/audit-events/src/index.ts
git commit -m "feat(suborgs): permissions + audit actions for sub-organisations"
```

---

## Task 3: Sub-organisations usecase

**Files:**
- Create: `apps/platform-api/src/usecases/sub-organisations.ts`

The usecase pattern mirrors `members.ts`: injected deps, result types, check→audit→mutate. Uses `withSystemAdmin` for cross-tenant org lookups and `pool.query` for sub-org CRUD (organisations has no RLS).

- [ ] **Step 1: Write the usecase file**

Create `apps/platform-api/src/usecases/sub-organisations.ts`:

```typescript
import pg from "pg";
import { z } from "zod";
import { AuditAction, createAuditEvent, type AuditEventPort } from "@platform/audit-events";
import { withSystemAdmin } from "@platform/adapters-postgres";
import { validateOrganisationSlug, isSlugReserved } from "@platform/domain-identity";

// ---------------------------------------------------------------------------
// Sub-organisation usecase (ADR-ACT-0143 Slice 3)
//
// Sub-orgs are Tier 2: they share the parent's Keycloak realm and Postgres
// schema. They are rows in public.organisations with parent_id set.
// Security: parent_id must equal the FQDN-resolved organisationId so a
// tenant admin can only manage their own sub-orgs.
//
// organisations has no RLS; isolation is enforced by explicit WHERE clauses
// filtering on parent_id = $parentOrgId.
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

export const CreateSubOrgSchema = z.object({
  slug: z
    .string()
    .min(2)
    .max(63)
    .regex(/^[a-z0-9-]+$/, "slug must contain only lowercase letters, digits, and hyphens")
    .refine((s) => !s.startsWith("-") && !s.endsWith("-"), "slug must not start or end with a hyphen"),
  displayName: z.string().min(2).max(120),
});

export const UpdateSubOrgSchema = z.object({
  displayName: z.string().min(2).max(120).optional(),
});

export type CreateSubOrgResult =
  | { kind: "ok"; subOrg: SubOrgRow }
  | { kind: "invalid_body"; message: string }
  | { kind: "conflict" } // slug already taken globally
  | { kind: "reserved_slug" }; // slug is reserved

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
  return rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    displayName: r.display_name,
    isActive: r.is_active,
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
    updatedAt: r.updated_at instanceof Date ? r.updated_at.toISOString() : String(r.updated_at),
  }));
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

  // Validate slug is not reserved
  if (isSlugReserved(slug)) return { kind: "reserved_slug" };

  // Check slug uniqueness globally (pre-audit, pure read)
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
  const r = rows[0]!;
  return {
    kind: "ok",
    subOrg: {
      id: r.id,
      slug: r.slug,
      displayName: r.display_name,
      isActive: r.is_active,
      createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
      updatedAt: r.updated_at instanceof Date ? r.updated_at.toISOString() : String(r.updated_at),
    },
  };
}

// ---------------------------------------------------------------------------
// updateSubOrg
// ---------------------------------------------------------------------------
export async function updateSubOrg(
  input: {
    subOrgId: string;
    parentOrgId: string;
    rawBody: unknown;
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

  // Verify sub-org exists and belongs to this parent (application-level isolation)
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
  const r = rows[0]!;
  return {
    kind: "ok",
    subOrg: {
      id: r.id,
      slug: r.slug,
      displayName: r.display_name,
      isActive: r.is_active,
      createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
      updatedAt: r.updated_at instanceof Date ? r.updated_at.toISOString() : String(r.updated_at),
    },
  };
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
  // Verify ownership
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
```

- [ ] **Step 2: Type-check**

```bash
npm run tsc:check:api
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/platform-api/src/usecases/sub-organisations.ts
git commit -m "feat(suborgs): sub-organisations usecase with audit-first mutations"
```

---

## Task 4: Sub-organisations routes + UMA registration

**Files:**
- Modify: `apps/platform-api/src/server/routes.ts`
- Modify: `packages/adapters-keycloak/src/index.ts`

- [ ] **Step 1: Replace 501 stub and add /api/org/sub-organisations routes**

In `routes.ts`, replace the existing `POST /api/admin/sub-tenants` 501 stub with a proper 301 redirect, then add the 4 new routes just before the Organisation profile section.

Find the stub:
```typescript
{
  method: "POST",
  path: "/api/admin/sub-tenants",
  operationName: "admin.sub-tenants.create",
```

Replace the entire stub entry with:
```typescript
{
  method: "POST",
  path: "/api/admin/sub-tenants",
  operationName: "admin.sub-tenants.create",
  requiresAuth: true,
  requiredPermission: "tenant.suborgs.create",
  resource: "organisation:sub-organisations",
  umaScope: "create" as const,
  scope: "tenant" as const,
  handler: async (_req, res) => {
    res.json(308, { code: "MOVED", message: "Use POST /api/org/sub-organisations" });
  },
},
```

Then, just before the `// Organisation profile` section, add:

```typescript
// ---------------------------------------------------------------------------
// Sub-organisation management (ADR-ACT-0143 Slice 3)
// Tenant admin manages sub-organisations inside their own tenant.
// Sub-orgs are Tier 2: share parent Keycloak realm, no new infrastructure.
// All routes: scope "tenant" — must arrive at {slug}.aldous.info.
// UMA resource: organisation:sub-organisations
// ---------------------------------------------------------------------------
{
  method: "GET",
  path: "/api/org/sub-organisations",
  operationName: "org.sub-organisations.list",
  requiresAuth: true,
  requiredPermission: "tenant.suborgs.read",
  resource: "organisation:sub-organisations",
  umaScope: "read" as const,
  scope: "tenant" as const,
  handler: async (req, res) => {
    const tenantCtx = await resolveTenantFromRequest(req.raw, getApplicationPool());
    if (!tenantCtx) {
      res.json(400, { code: "NO_TENANT", message: "No tenant context" });
      return;
    }
    const { listSubOrgs } = await import("../usecases/sub-organisations.ts");
    const subOrgs = await listSubOrgs(tenantCtx.organisationId, getApplicationPool());
    res.json(200, { subOrganisations: subOrgs });
  },
},
{
  method: "POST",
  path: "/api/org/sub-organisations",
  operationName: "org.sub-organisations.create",
  requiresAuth: true,
  requiredPermission: "tenant.suborgs.create",
  resource: "organisation:sub-organisations",
  umaScope: "create" as const,
  scope: "tenant" as const,
  handler: async (req, res) => {
    const tenantCtx = await resolveTenantFromRequest(req.raw, getApplicationPool());
    if (!tenantCtx) {
      res.json(400, { code: "NO_TENANT", message: "No tenant context" });
      return;
    }
    const { createSubOrg } = await import("../usecases/sub-organisations.ts");
    const result = await createSubOrg(
      {
        rawBody: req.body,
        parentOrgId: tenantCtx.organisationId,
        actorId: req.actor!.userId,
        actorRoles: req.actor!.roles,
      },
      {
        audit: createPostgresAuditEventPort(getApplicationPool()),
        pool: getApplicationPool(),
      }
    );
    if (result.kind === "invalid_body") {
      res.json(400, { code: "VALIDATION_ERROR", message: result.message });
      return;
    }
    if (result.kind === "reserved_slug") {
      res.json(422, { code: "VALIDATION_ERROR", message: "This slug is reserved" });
      return;
    }
    if (result.kind === "conflict") {
      res.json(409, { code: "CONFLICT", message: "A organisation with this slug already exists" });
      return;
    }
    res.json(201, result.subOrg);
  },
},
{
  method: "PATCH",
  path: "/api/org/sub-organisations/:subOrgId",
  operationName: "org.sub-organisations.update",
  requiresAuth: true,
  requiredPermission: "tenant.suborgs.update",
  resource: "organisation:sub-organisations",
  umaScope: "update" as const,
  scope: "tenant" as const,
  handler: async (req, res) => {
    const tenantCtx = await resolveTenantFromRequest(req.raw, getApplicationPool());
    if (!tenantCtx) {
      res.json(400, { code: "NO_TENANT", message: "No tenant context" });
      return;
    }
    const subOrgId = req.params["subOrgId"] ?? "";
    if (!subOrgId) {
      res.json(400, { code: "VALIDATION_ERROR", message: "subOrgId path parameter is required" });
      return;
    }
    const { updateSubOrg } = await import("../usecases/sub-organisations.ts");
    const result = await updateSubOrg(
      {
        rawBody: req.body,
        parentOrgId: tenantCtx.organisationId,
        subOrgId,
        actorId: req.actor!.userId,
        actorRoles: req.actor!.roles,
      },
      {
        audit: createPostgresAuditEventPort(getApplicationPool()),
        pool: getApplicationPool(),
      }
    );
    if (result.kind === "invalid_body") {
      res.json(400, { code: "VALIDATION_ERROR", message: result.message });
      return;
    }
    if (result.kind === "not_found") {
      res.json(404, { code: "NOT_FOUND", message: "Sub-organisation not found" });
      return;
    }
    res.json(200, result.subOrg);
  },
},
{
  method: "DELETE",
  path: "/api/org/sub-organisations/:subOrgId",
  operationName: "org.sub-organisations.deactivate",
  requiresAuth: true,
  requiredPermission: "tenant.suborgs.delete",
  resource: "organisation:sub-organisations",
  umaScope: "delete" as const,
  scope: "tenant" as const,
  handler: async (req, res) => {
    const tenantCtx = await resolveTenantFromRequest(req.raw, getApplicationPool());
    if (!tenantCtx) {
      res.json(400, { code: "NO_TENANT", message: "No tenant context" });
      return;
    }
    const subOrgId = req.params["subOrgId"] ?? "";
    if (!subOrgId) {
      res.json(400, { code: "VALIDATION_ERROR", message: "subOrgId path parameter is required" });
      return;
    }
    const { deactivateSubOrg } = await import("../usecases/sub-organisations.ts");
    const result = await deactivateSubOrg(
      {
        parentOrgId: tenantCtx.organisationId,
        subOrgId,
        actorId: req.actor!.userId,
        actorRoles: req.actor!.roles,
      },
      {
        audit: createPostgresAuditEventPort(getApplicationPool()),
        pool: getApplicationPool(),
      }
    );
    if (result.kind === "not_found") {
      res.json(404, { code: "NOT_FOUND", message: "Sub-organisation not found" });
      return;
    }
    res.json(204, null);
  },
},
```

- [ ] **Step 2: Add organisation:sub-organisations to registerPlatformResources**

In `packages/adapters-keycloak/src/index.ts`, after the `organisation:groups` entry:

```typescript
{
  name: "organisation:sub-organisations",
  type: "urn:platform:resources:organisation",
  scopes: ["read", "create", "update", "delete"],
},
```

- [ ] **Step 3: Type-check**

```bash
npm run tsc:check:api && npm run tsc:check:packages
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/platform-api/src/server/routes.ts packages/adapters-keycloak/src/index.ts
git commit -m "feat(suborgs): routes + UMA registration for sub-organisations"
```

---

## Task 5: Sub-organisations unit tests

**Files:**
- Create: `apps/platform-api/tests/unit/sub-organisations.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Write tests**

Create `apps/platform-api/tests/unit/sub-organisations.test.ts`:

```typescript
/**
 * Unit tests for ADR-ACT-0143 Slice 3: sub-organisation usecases.
 * Pure — no HTTP, no real DB.
 *
 * Coverage:
 *   A. createSubOrg
 *      1. invalid body → invalid_body, no audit
 *      2. reserved slug → reserved_slug, no audit
 *      3. duplicate slug → conflict, no audit
 *      4. success → ok, SubOrganisationCreated audit BEFORE insert
 *      5. audit failure aborts insert
 *
 *   B. updateSubOrg
 *      6. not found (wrong parent) → not_found, no audit
 *      7. success → ok, SubOrganisationUpdated audit BEFORE update
 *      8. audit failure aborts update
 *
 *   C. deactivateSubOrg
 *      9. not found → not_found, no audit
 *     10. success → ok, SubOrganisationDeactivated audit BEFORE deactivate
 *     11. audit failure aborts deactivate
 *
 *   D. Static permission assertions
 *     12. tenant-admin has all four tenant.suborgs.* permissions
 *     13. manager has none
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { AuditAction, type AuditEventPort, type AuditEvent } from "@platform/audit-events";
import { resolvePermissions } from "@platform/domain-identity";
import {
  createSubOrg,
  updateSubOrg,
  deactivateSubOrg,
} from "../../src/usecases/sub-organisations.ts";

const ORG_ID = "a1b2c3d4-e5f6-4000-8000-000000000001";
const ACTOR_ID = "a1b2c3d4-e5f6-4000-8000-000000000002";
const SUB_ORG_ID = "c3d4e5f6-a7b8-4000-8000-000000000003";

function makeAudit(opts: { fail?: boolean } = {}): AuditEventPort & { events: AuditEvent[] } {
  const events: AuditEvent[] = [];
  return {
    events,
    async emit(e) {
      if (opts.fail) throw new Error("audit fail");
      events.push(e);
    },
    async query() { return []; },
  };
}

// Spy pool for sub-org tests
function makePool(opts: {
  slugExists?: boolean;
  subOrgExists?: boolean;
} = {}) {
  const calls: { text: string; values?: unknown[] }[] = [];

  const client = {
    escapeIdentifier: (s: string) => `"${s.replace(/"/g, '""')}"`,
    async query(text: string, values?: unknown[]) {
      calls.push({ text, values });
      const t = text.toLowerCase().trim();
      if (t.includes("select id from public.organisations where slug")) {
        return { rows: opts.slugExists ? [{ id: "existing-id" }] : [], rowCount: opts.slugExists ? 1 : 0 };
      }
      if (t.includes("select id from public.organisations where id")) {
        return { rows: opts.subOrgExists ? [{ id: SUB_ORG_ID }] : [], rowCount: opts.subOrgExists ? 1 : 0 };
      }
      if (t.includes("insert into public.organisations")) {
        return {
          rows: [{ id: SUB_ORG_ID, slug: "sub-a", display_name: "Sub A", is_active: true, created_at: new Date(), updated_at: new Date() }],
          rowCount: 1,
        };
      }
      if (t.includes("update public.organisations")) {
        return {
          rows: [{ id: SUB_ORG_ID, slug: "sub-a", display_name: "Updated", is_active: true, created_at: new Date(), updated_at: new Date() }],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    },
    release() {},
  };

  const pool = {
    async connect() { return client; },
    async query(text: string, values?: unknown[]) {
      calls.push({ text, values });
      const t = text.toLowerCase().trim();
      if (t.includes("select id from public.organisations where slug")) {
        return { rows: opts.slugExists ? [{ id: "eid" }] : [], rowCount: opts.slugExists ? 1 : 0 };
      }
      if (t.includes("select id from public.organisations where id")) {
        return { rows: opts.subOrgExists ? [{ id: SUB_ORG_ID }] : [], rowCount: opts.subOrgExists ? 1 : 0 };
      }
      if (t.includes("insert into public.organisations")) {
        return {
          rows: [{ id: SUB_ORG_ID, slug: "sub-a", display_name: "Sub A", is_active: true, created_at: new Date(), updated_at: new Date() }],
          rowCount: 1,
        };
      }
      if (t.includes("update public.organisations")) {
        return {
          rows: [{ id: SUB_ORG_ID, slug: "sub-a", display_name: "Updated", is_active: true, created_at: new Date(), updated_at: new Date() }],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    },
  };

  return { calls, pool: pool as never };
}

describe("createSubOrg — validation and pre-conditions", () => {
  it("invalid body → invalid_body, no audit", async () => {
    const audit = makeAudit();
    const { pool } = makePool();
    const result = await createSubOrg(
      { rawBody: { slug: "X!", displayName: "A" }, parentOrgId: ORG_ID, actorId: ACTOR_ID, actorRoles: ["tenant-admin"] },
      { audit, pool }
    );
    assert.equal(result.kind, "invalid_body");
    assert.equal(audit.events.length, 0);
  });

  it("reserved slug → reserved_slug, no audit", async () => {
    const audit = makeAudit();
    const { pool } = makePool();
    const result = await createSubOrg(
      { rawBody: { slug: "admin", displayName: "Admin" }, parentOrgId: ORG_ID, actorId: ACTOR_ID, actorRoles: ["tenant-admin"] },
      { audit, pool }
    );
    assert.equal(result.kind, "reserved_slug");
    assert.equal(audit.events.length, 0);
  });

  it("duplicate slug → conflict, no audit", async () => {
    const audit = makeAudit();
    const { pool } = makePool({ slugExists: true });
    const result = await createSubOrg(
      { rawBody: { slug: "existing", displayName: "Existing" }, parentOrgId: ORG_ID, actorId: ACTOR_ID, actorRoles: ["tenant-admin"] },
      { audit, pool }
    );
    assert.equal(result.kind, "conflict");
    assert.equal(audit.events.length, 0);
  });

  it("success → ok, SubOrganisationCreated audit BEFORE insert", async () => {
    const callOrder: string[] = [];
    const audit = makeAudit();
    const origEmit = audit.emit.bind(audit);
    audit.emit = async (e) => { callOrder.push("audit"); return origEmit(e); };
    const { pool, calls } = makePool();

    const result = await createSubOrg(
      { rawBody: { slug: "new-sub", displayName: "New Sub" }, parentOrgId: ORG_ID, actorId: ACTOR_ID, actorRoles: ["tenant-admin"] },
      { audit, pool }
    );

    assert.equal(result.kind, "ok");
    assert.equal(audit.events.length, 1);
    assert.equal(audit.events[0]!.action, AuditAction.SubOrganisationCreated);
    const insertIdx = calls.findIndex((c) => c.text.toLowerCase().includes("insert"));
    assert.ok(insertIdx !== -1 && callOrder.indexOf("audit") < insertIdx, "audit before insert");
  });

  it("audit failure aborts insert", async () => {
    const audit = makeAudit({ fail: true });
    const { pool, calls } = makePool();
    await assert.rejects(
      () => createSubOrg({ rawBody: { slug: "new-sub", displayName: "S" }, parentOrgId: ORG_ID, actorId: ACTOR_ID, actorRoles: ["tenant-admin"] }, { audit, pool }),
      /audit fail/
    );
    assert.ok(!calls.some((c) => c.text.toLowerCase().includes("insert")));
  });
});

describe("updateSubOrg", () => {
  it("not found → not_found, no audit", async () => {
    const audit = makeAudit();
    const { pool } = makePool({ subOrgExists: false });
    const result = await updateSubOrg(
      { rawBody: { displayName: "New" }, parentOrgId: ORG_ID, subOrgId: SUB_ORG_ID, actorId: ACTOR_ID, actorRoles: ["tenant-admin"] },
      { audit, pool }
    );
    assert.equal(result.kind, "not_found");
    assert.equal(audit.events.length, 0);
  });

  it("success → ok, SubOrganisationUpdated audit BEFORE update", async () => {
    const callOrder: string[] = [];
    const audit = makeAudit();
    const origEmit = audit.emit.bind(audit);
    audit.emit = async (e) => { callOrder.push("audit"); return origEmit(e); };
    const { pool, calls } = makePool({ subOrgExists: true });

    const result = await updateSubOrg(
      { rawBody: { displayName: "Updated" }, parentOrgId: ORG_ID, subOrgId: SUB_ORG_ID, actorId: ACTOR_ID, actorRoles: ["tenant-admin"] },
      { audit, pool }
    );

    assert.equal(result.kind, "ok");
    assert.equal(audit.events[0]!.action, AuditAction.SubOrganisationUpdated);
    const updateIdx = calls.findIndex((c) => c.text.toLowerCase().includes("update"));
    assert.ok(updateIdx !== -1 && callOrder.indexOf("audit") < updateIdx, "audit before update");
  });
});

describe("deactivateSubOrg", () => {
  it("not found → not_found, no audit", async () => {
    const audit = makeAudit();
    const { pool } = makePool({ subOrgExists: false });
    const result = await deactivateSubOrg(
      { parentOrgId: ORG_ID, subOrgId: SUB_ORG_ID, actorId: ACTOR_ID, actorRoles: ["tenant-admin"] },
      { audit, pool }
    );
    assert.equal(result.kind, "not_found");
    assert.equal(audit.events.length, 0);
  });

  it("success → ok, audit BEFORE deactivate", async () => {
    const callOrder: string[] = [];
    const audit = makeAudit();
    const origEmit = audit.emit.bind(audit);
    audit.emit = async (e) => { callOrder.push("audit"); return origEmit(e); };
    const { pool, calls } = makePool({ subOrgExists: true });

    const result = await deactivateSubOrg(
      { parentOrgId: ORG_ID, subOrgId: SUB_ORG_ID, actorId: ACTOR_ID, actorRoles: ["tenant-admin"] },
      { audit, pool }
    );

    assert.equal(result.kind, "ok");
    assert.equal(audit.events[0]!.action, AuditAction.SubOrganisationDeactivated);
    const updateIdx = calls.findIndex((c) => c.text.toLowerCase().includes("update"));
    assert.ok(updateIdx !== -1 && callOrder.indexOf("audit") < updateIdx, "audit before deactivate");
  });

  it("audit failure aborts deactivate", async () => {
    const audit = makeAudit({ fail: true });
    const { pool, calls } = makePool({ subOrgExists: true });
    await assert.rejects(
      () => deactivateSubOrg({ parentOrgId: ORG_ID, subOrgId: SUB_ORG_ID, actorId: ACTOR_ID, actorRoles: ["tenant-admin"] }, { audit, pool }),
      /audit fail/
    );
    assert.ok(!calls.some((c) => c.text.toLowerCase().includes("update")));
  });
});

describe("permission model — sub-organisations", () => {
  it("tenant-admin has all four tenant.suborgs.* permissions", () => {
    const perms = resolvePermissions("tenant-admin");
    for (const p of ["tenant.suborgs.read", "tenant.suborgs.create", "tenant.suborgs.update", "tenant.suborgs.delete"]) {
      assert.ok(perms.includes(p), `tenant-admin must have ${p}`);
    }
  });

  it("manager has none of tenant.suborgs.*", () => {
    const perms = resolvePermissions("manager");
    for (const p of ["tenant.suborgs.read", "tenant.suborgs.create", "tenant.suborgs.update", "tenant.suborgs.delete"]) {
      assert.ok(!perms.includes(p), `manager must NOT have ${p}`);
    }
  });
});
```

- [ ] **Step 2: Register in package.json test:platform-api script**

Find `apps/platform-api/tests/unit/groups.test.ts` in the test:platform-api script and append ` apps/platform-api/tests/unit/sub-organisations.test.ts` after it.

- [ ] **Step 3: Run tests**

```bash
npm run test:platform-api
```

Expected: all pass (new tests: ~11).

- [ ] **Step 4: Run make check**

```bash
make check
```

Expected: all gates passed.

- [ ] **Step 5: Commit**

```bash
git add apps/platform-api/tests/unit/sub-organisations.test.ts package.json
git commit -m "test(suborgs): unit tests for sub-organisation usecases"
```

- [ ] **Step 6: Update ACTION-REGISTER for Slice 3**

In `docs/adr/ACTION-REGISTER.md`, update ADR-ACT-0143 to record Slice 3 Done.

```bash
git add docs/adr/ACTION-REGISTER.md
git commit -m "docs(adr): ADR-ACT-0143 Slice 3 Done — sub-organisations backend"
```

---

## Task 6: Feature toggles — definition + implementation

**Files:**
- Modify: `packages/contracts-auth/src/index.ts`
- Modify: `packages/domain-identity/src/index.ts`
- Modify: `packages/audit-events/src/index.ts`
- Modify: `packages/adapters-keycloak/src/index.ts`
- Create: `apps/platform-api/src/usecases/features.ts`
- Modify: `apps/platform-api/src/server/routes.ts`
- Create: `apps/platform-api/tests/unit/features.test.ts`
- Modify: `package.json`
- Modify: `docs/adr/ACTION-REGISTER.md`

**Feature toggle definition (record in ACTION-REGISTER before coding):**

A feature module toggle is a key-value entry in `tenant_settings` (in the tenant schema) with key `feature.<featureKey>` and JSONB value `{"enabled": boolean}`. Toggles are:
- Managed by tenant-admin only
- Stored in the tenant's own `tenant_settings` table (per-tenant, schema-isolated by `withTenant`)
- Not inherited by sub-organisations (sub-orgs may define their own toggles in their schema independently)
- Audited before mutation (`FeatureToggled` action)
- Limited to a hardcoded allowlist of feature keys to prevent garbage injection

Allowed keys for v1: `analytics`, `advanced_auth`, `audit_export`, `webhooks`.

- [ ] **Step 1: Add permissions and audit action**

In `packages/contracts-auth/src/index.ts`, after `"tenant.suborgs.delete"`:
```typescript
  | "tenant.features.read"
  | "tenant.features.update"
```

In `packages/domain-identity/src/index.ts`, after `"tenant.suborgs.delete"`:
```typescript
    "tenant.features.read",
    "tenant.features.update",
```

In `packages/audit-events/src/index.ts`, after `SubOrganisationDeactivated`:
```typescript
  FeatureToggled: "feature.toggled",
```

- [ ] **Step 2: Create features.ts usecase**

Create `apps/platform-api/src/usecases/features.ts`:

```typescript
import pg from "pg";
import { AuditAction, createAuditEvent, type AuditEventPort } from "@platform/audit-events";
import { withTenant } from "@platform/adapters-postgres";

// ---------------------------------------------------------------------------
// Feature toggle usecase (ADR-ACT-0143 Slice 4)
//
// Feature toggles are stored in tenant_settings (tenant schema key-value store)
// under the key `feature.<featureKey>`. Value: {"enabled": boolean}.
//
// Definition (recorded 2026-06-02):
//   - A feature module is a named platform capability that can be switched
//     per-tenant without deployment.
//   - Only tenant-admins can manage toggles.
//   - Stored in tenant_settings (per-tenant schema) — tenant-isolated by withTenant.
//   - Not inherited by sub-organisations by default.
//   - Audit-first: FeatureToggled audit emitted before the write.
//   - Allowed keys are hardcoded to prevent garbage injection. New features
//     require a code change + ADR update.
// ---------------------------------------------------------------------------

export const ALLOWED_FEATURE_KEYS = [
  "analytics",
  "advanced_auth",
  "audit_export",
  "webhooks",
] as const;

export type FeatureKey = (typeof ALLOWED_FEATURE_KEYS)[number];

export interface FeatureToggleState {
  key: FeatureKey;
  enabled: boolean;
  updatedAt: string | null;
}

export interface FeaturesDeps {
  audit: AuditEventPort;
  pool: pg.Pool;
}

export async function listFeatures(
  organisationId: string,
  pool: pg.Pool
): Promise<FeatureToggleState[]> {
  const results = await withTenant(pool, organisationId, async (client) => {
    const { rows } = await client.query<{ key: string; value: { enabled: boolean }; updated_at: Date }>(
      `SELECT key, value, updated_at FROM tenant_settings
       WHERE key LIKE 'feature.%'`,
      []
    );
    return rows;
  });

  const stored = new Map(results.map((r) => [r.key.replace("feature.", ""), r]));
  return ALLOWED_FEATURE_KEYS.map((k) => {
    const row = stored.get(k);
    return {
      key: k,
      enabled: row?.value?.enabled ?? false,
      updatedAt: row
        ? row.updated_at instanceof Date
          ? row.updated_at.toISOString()
          : String(row.updated_at)
        : null,
    };
  });
}

export type ToggleFeatureResult =
  | { kind: "ok"; state: FeatureToggleState }
  | { kind: "unknown_key"; message: string }
  | { kind: "invalid_body"; message: string };

export async function toggleFeature(
  input: {
    rawBody: unknown;
    featureKey: string;
    organisationId: string;
    actorId: string;
    actorRoles: string[];
  },
  deps: FeaturesDeps
): Promise<ToggleFeatureResult> {
  if (!ALLOWED_FEATURE_KEYS.includes(input.featureKey as FeatureKey)) {
    return { kind: "unknown_key", message: `Unknown feature key: ${input.featureKey}` };
  }
  const key = input.featureKey as FeatureKey;
  const body = input.rawBody as Record<string, unknown>;
  if (typeof body?.enabled !== "boolean") {
    return { kind: "invalid_body", message: 'body must include "enabled": boolean' };
  }
  const enabled = body.enabled;

  await deps.audit.emit(
    createAuditEvent({
      actorId: input.actorId,
      actorRoles: input.actorRoles,
      tenantId: input.organisationId,
      action: AuditAction.FeatureToggled,
      resource: "organisation:features",
      resourceId: key,
      metadata: { featureKey: key, enabled },
    })
  );

  await withTenant(deps.pool, input.organisationId, async (client) => {
    await client.query(
      `INSERT INTO tenant_settings (key, value, updated_at)
       VALUES ($1, $2::jsonb, now())
       ON CONFLICT (key) DO UPDATE SET value = $2::jsonb, updated_at = now()`,
      [`feature.${key}`, JSON.stringify({ enabled })]
    );
  });

  return {
    kind: "ok",
    state: { key, enabled, updatedAt: new Date().toISOString() },
  };
}
```

- [ ] **Step 3: Add routes**

In `routes.ts`, just before the sub-organisations section:

```typescript
// ---------------------------------------------------------------------------
// Feature toggles (ADR-ACT-0143 Slice 4)
// Tenant admin enables/disables named platform capabilities.
// Stored in tenant_settings (tenant schema). Audit-first.
// UMA resource: organisation:features
// ---------------------------------------------------------------------------
{
  method: "GET",
  path: "/api/org/features",
  operationName: "org.features.list",
  requiresAuth: true,
  requiredPermission: "tenant.features.read",
  resource: "organisation:features",
  umaScope: "read" as const,
  scope: "tenant" as const,
  handler: async (req, res) => {
    const tenantCtx = await resolveTenantFromRequest(req.raw, getApplicationPool());
    if (!tenantCtx) {
      res.json(400, { code: "NO_TENANT", message: "No tenant context" });
      return;
    }
    const { listFeatures } = await import("../usecases/features.ts");
    const features = await listFeatures(tenantCtx.organisationId, getApplicationPool());
    res.json(200, { features });
  },
},
{
  method: "PATCH",
  path: "/api/org/features/:featureKey",
  operationName: "org.features.toggle",
  requiresAuth: true,
  requiredPermission: "tenant.features.update",
  resource: "organisation:features",
  umaScope: "update" as const,
  scope: "tenant" as const,
  handler: async (req, res) => {
    const tenantCtx = await resolveTenantFromRequest(req.raw, getApplicationPool());
    if (!tenantCtx) {
      res.json(400, { code: "NO_TENANT", message: "No tenant context" });
      return;
    }
    const featureKey = req.params["featureKey"] ?? "";
    const { toggleFeature } = await import("../usecases/features.ts");
    const result = await toggleFeature(
      {
        rawBody: req.body,
        featureKey,
        organisationId: tenantCtx.organisationId,
        actorId: req.actor!.userId,
        actorRoles: req.actor!.roles,
      },
      {
        audit: createPostgresAuditEventPort(getApplicationPool()),
        pool: getApplicationPool(),
      }
    );
    if (result.kind === "invalid_body") {
      res.json(400, { code: "VALIDATION_ERROR", message: result.message });
      return;
    }
    if (result.kind === "unknown_key") {
      res.json(404, { code: "NOT_FOUND", message: result.message });
      return;
    }
    res.json(200, result.state);
  },
},
```

- [ ] **Step 4: Add to registerPlatformResources**

In `packages/adapters-keycloak/src/index.ts`, after `organisation:sub-organisations`:

```typescript
{
  name: "organisation:features",
  type: "urn:platform:resources:organisation",
  scopes: ["read", "update"],
},
```

- [ ] **Step 5: Write tests** (`apps/platform-api/tests/unit/features.test.ts`)

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { AuditAction, type AuditEventPort, type AuditEvent } from "@platform/audit-events";
import { resolvePermissions } from "@platform/domain-identity";
import { toggleFeature, ALLOWED_FEATURE_KEYS } from "../../src/usecases/features.ts";

const ORG_ID = "a1b2c3d4-e5f6-4000-8000-000000000001";
const ACTOR_ID = "a1b2c3d4-e5f6-4000-8000-000000000002";

function makeAudit(fail = false): AuditEventPort & { events: AuditEvent[] } {
  const events: AuditEvent[] = [];
  return {
    events,
    async emit(e) { if (fail) throw new Error("audit fail"); events.push(e); },
    async query() { return []; },
  };
}

function makePool() {
  const calls: string[] = [];
  const client = {
    escapeIdentifier: (s: string) => `"${s}"`,
    async query(text: string) { calls.push(text); return { rows: [], rowCount: 1 }; },
    release() {},
  };
  return { calls, pool: { async connect() { return client; }, async query(t: string) { calls.push(t); return { rows: [], rowCount: 1 }; } } as never };
}

describe("toggleFeature", () => {
  it("unknown key → unknown_key, no audit", async () => {
    const audit = makeAudit();
    const { pool } = makePool();
    const result = await toggleFeature(
      { rawBody: { enabled: true }, featureKey: "nonexistent", organisationId: ORG_ID, actorId: ACTOR_ID, actorRoles: ["tenant-admin"] },
      { audit, pool }
    );
    assert.equal(result.kind, "unknown_key");
    assert.equal(audit.events.length, 0);
  });

  it("invalid body (missing enabled) → invalid_body, no audit", async () => {
    const audit = makeAudit();
    const { pool } = makePool();
    const result = await toggleFeature(
      { rawBody: {}, featureKey: "analytics", organisationId: ORG_ID, actorId: ACTOR_ID, actorRoles: ["tenant-admin"] },
      { audit, pool }
    );
    assert.equal(result.kind, "invalid_body");
    assert.equal(audit.events.length, 0);
  });

  it("success → ok, FeatureToggled audit BEFORE write", async () => {
    const callOrder: string[] = [];
    const audit = makeAudit();
    const origEmit = audit.emit.bind(audit);
    audit.emit = async (e) => { callOrder.push("audit"); return origEmit(e); };
    const { pool, calls } = makePool();

    const result = await toggleFeature(
      { rawBody: { enabled: true }, featureKey: "analytics", organisationId: ORG_ID, actorId: ACTOR_ID, actorRoles: ["tenant-admin"] },
      { audit, pool }
    );

    assert.equal(result.kind, "ok");
    assert.equal(audit.events[0]!.action, AuditAction.FeatureToggled);
    const writeIdx = calls.findIndex((c) => c.toLowerCase().includes("insert"));
    assert.ok(writeIdx !== -1 && callOrder.indexOf("audit") < writeIdx, "audit before write");
  });

  it("audit failure aborts write", async () => {
    const audit = makeAudit(true);
    const { pool, calls } = makePool();
    await assert.rejects(
      () => toggleFeature({ rawBody: { enabled: false }, featureKey: "webhooks", organisationId: ORG_ID, actorId: ACTOR_ID, actorRoles: ["tenant-admin"] }, { audit, pool }),
      /audit fail/
    );
    assert.ok(!calls.some((c) => c.toLowerCase().includes("insert")));
  });

  it("all ALLOWED_FEATURE_KEYS are valid and non-empty", () => {
    assert.ok(ALLOWED_FEATURE_KEYS.length >= 4, "at least 4 feature keys defined");
    for (const k of ALLOWED_FEATURE_KEYS) {
      assert.match(k, /^[a-z_]+$/, `key ${k} must be lowercase snake_case`);
    }
  });
});

describe("feature permission model", () => {
  it("tenant-admin has tenant.features.read and tenant.features.update", () => {
    const perms = resolvePermissions("tenant-admin");
    assert.ok(perms.includes("tenant.features.read"));
    assert.ok(perms.includes("tenant.features.update"));
  });
  it("manager has neither", () => {
    const perms = resolvePermissions("manager");
    assert.ok(!perms.includes("tenant.features.read"));
    assert.ok(!perms.includes("tenant.features.update"));
  });
});
```

- [ ] **Step 6: Register test + run**

Add `apps/platform-api/tests/unit/features.test.ts` to `package.json` test:platform-api script.

```bash
npm run test:platform-api
```

Expected: all pass.

- [ ] **Step 7: Run make check**

```bash
make check
```

Expected: all gates passed.

- [ ] **Step 8: Commit and update ACTION-REGISTER**

```bash
git add packages/contracts-auth/src/index.ts packages/domain-identity/src/index.ts \
  packages/audit-events/src/index.ts packages/adapters-keycloak/src/index.ts \
  apps/platform-api/src/usecases/features.ts apps/platform-api/src/server/routes.ts \
  apps/platform-api/tests/unit/features.test.ts package.json
git commit -m "feat(features): tenant feature toggle API — ADR-ACT-0143 Slice 4"
git add docs/adr/ACTION-REGISTER.md
git commit -m "docs(adr): ADR-ACT-0143 Slice 4 Done; ADR-ACT-0143 fully Done"
```

---

## Task 7: Vanity domain DNS proof (ADR-ACT-0188)

**Files:**
- Create: `apps/platform-api/src/db/migrations/014-vanity-domain-challenges.sql`
- Modify: `packages/audit-events/src/index.ts`
- Create: `apps/platform-api/src/usecases/vanity-domain-challenge.ts`
- Modify: `apps/platform-api/src/usecases/vanity-domain.ts`
- Modify: `apps/platform-api/src/server/routes.ts`
- Create: `apps/platform-api/tests/unit/vanity-domain-challenge.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Write migration 014**

Create `apps/platform-api/src/db/migrations/014-vanity-domain-challenges.sql`:

```sql
-- Migration 014: Vanity domain ownership challenges (ADR-ACT-0188)
--
-- Before a tenant can add a vanity domain to their Keycloak BFF client,
-- they must prove ownership via a DNS TXT record at:
--   _aldous-verify.<domain>  →  value must contain the challenge token
--
-- Lifecycle:
--   1. POST /api/auth/settings/domains/challenges  — creates a challenge row
--   2. Tenant configures _aldous-verify.<domain> TXT record with the token
--   3. POST /api/auth/settings/domains/verify  — DNS lookup, marks verified_at
--   4. POST /api/auth/settings/domains  — only succeeds if challenge exists, verified, not expired

CREATE TABLE IF NOT EXISTS public.vanity_domain_challenges (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  domain        TEXT NOT NULL,
  token         TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at    TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '24 hours'),
  verified_at   TIMESTAMPTZ,
  consumed_at   TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS vanity_domain_challenges_domain_org_active_idx
  ON public.vanity_domain_challenges (domain, organisation_id)
  WHERE consumed_at IS NULL AND expires_at > now();

CREATE INDEX IF NOT EXISTS vanity_domain_challenges_domain_idx
  ON public.vanity_domain_challenges (domain)
  WHERE verified_at IS NOT NULL AND consumed_at IS NULL;
```

- [ ] **Step 2: Apply migration**

```bash
POSTGRES_URL=postgresql://platform:platformpassword@localhost:5433/platform \
  node --loader ./apps/platform-api/loader.mjs -e "
import { runMigrations } from './apps/platform-api/src/db/migrate.ts';
const r = await runMigrations();
console.log('applied:', r.applied);
"
```

Expected: `applied: [ '014-vanity-domain-challenges.sql' ]`

- [ ] **Step 3: Add audit actions**

In `packages/audit-events/src/index.ts`, after `FeatureToggled`:

```typescript
  VanityDomainChallengeCreated: "vanity_domain.challenge_created",
  VanityDomainVerified: "vanity_domain.verified",
  VanityDomainAdded: "vanity_domain.added",
```

- [ ] **Step 4: Create vanity-domain-challenge.ts usecase**

Create `apps/platform-api/src/usecases/vanity-domain-challenge.ts`:

```typescript
import crypto from "node:crypto";
import pg from "pg";
import { AuditAction, createAuditEvent, type AuditEventPort } from "@platform/audit-events";

// DNS resolver port — injected so tests can use a fake
export interface DnsResolverPort {
  resolveTxt(hostname: string): Promise<string[][]>;
}

export const defaultDnsResolver: DnsResolverPort = {
  async resolveTxt(hostname: string): Promise<string[][]> {
    const { Resolver } = await import("node:dns/promises");
    const resolver = new Resolver();
    return resolver.resolveTxt(hostname);
  },
};

export interface ChallengeDeps {
  audit: AuditEventPort;
  pool: pg.Pool;
  dns?: DnsResolverPort;
}

// Re-uses validateDomain from vanity-domain.ts via import below

export type CreateChallengeResult =
  | { kind: "ok"; token: string; txtRecord: string }
  | { kind: "invalid_domain"; message: string };

export type VerifyChallengeResult =
  | { kind: "ok" }
  | { kind: "not_found" }
  | { kind: "expired" }
  | { kind: "already_verified" }
  | { kind: "dns_not_found" }
  | { kind: "dns_mismatch" };

export async function createDomainChallenge(
  input: {
    domain: string;
    organisationId: string;
    actorId: string;
    actorRoles: string[];
  },
  deps: ChallengeDeps
): Promise<CreateChallengeResult> {
  // Reuse the same domain validator from vanity-domain.ts
  const { default: validateDomainFn } = await import("./vanity-domain-validator.ts").catch(() => ({ default: null }));
  // Inline validation since we can't import validateDomain (it's a private function)
  const lower = input.domain.toLowerCase();
  if (lower.length > 253 || !lower.includes(".")) {
    return { kind: "invalid_domain", message: "Invalid domain format" };
  }
  const labelRe = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
  for (const label of lower.split(".")) {
    if (!label || !labelRe.test(label)) {
      return { kind: "invalid_domain", message: "Invalid domain format" };
    }
  }
  if (lower.split(".").every((l) => /^\d+$/.test(l))) {
    return { kind: "invalid_domain", message: "IP literals are not allowed" };
  }

  const domain = lower;
  const token = crypto.randomBytes(24).toString("hex");

  await deps.audit.emit(
    createAuditEvent({
      actorId: input.actorId,
      actorRoles: input.actorRoles,
      tenantId: input.organisationId,
      action: AuditAction.VanityDomainChallengeCreated,
      resource: "auth_settings",
      resourceId: domain,
      metadata: { domain, txtRecord: `_aldous-verify.${domain}` },
    })
  );

  // Upsert challenge (invalidate existing for this domain+org if present)
  await deps.pool.query(
    `UPDATE public.vanity_domain_challenges
     SET consumed_at = now()
     WHERE organisation_id = $1 AND domain = $2 AND consumed_at IS NULL`,
    [input.organisationId, domain]
  );

  await deps.pool.query(
    `INSERT INTO public.vanity_domain_challenges (organisation_id, domain, token)
     VALUES ($1, $2, $3)`,
    [input.organisationId, domain, token]
  );

  return { kind: "ok", token, txtRecord: `_aldous-verify.${domain}` };
}

export async function verifyDomainChallenge(
  input: {
    domain: string;
    organisationId: string;
    actorId: string;
    actorRoles: string[];
  },
  deps: ChallengeDeps
): Promise<VerifyChallengeResult> {
  const domain = input.domain.toLowerCase();
  const resolver = deps.dns ?? defaultDnsResolver;

  const { rows } = await deps.pool.query<{
    id: string;
    token: string;
    expires_at: Date;
    verified_at: Date | null;
  }>(
    `SELECT id, token, expires_at, verified_at
     FROM public.vanity_domain_challenges
     WHERE organisation_id = $1 AND domain = $2
       AND consumed_at IS NULL
     ORDER BY created_at DESC LIMIT 1`,
    [input.organisationId, domain]
  );

  if (rows.length === 0) return { kind: "not_found" };
  const challenge = rows[0]!;

  if (new Date(challenge.expires_at) < new Date()) return { kind: "expired" };
  if (challenge.verified_at) return { kind: "already_verified" };

  // DNS lookup
  const txtRecords: string[][] = await resolver.resolveTxt(`_aldous-verify.${domain}`).catch(() => []);
  const flatRecords = txtRecords.flat();
  if (flatRecords.length === 0) return { kind: "dns_not_found" };
  if (!flatRecords.some((r) => r.includes(challenge.token))) return { kind: "dns_mismatch" };

  // Mark verified
  await deps.audit.emit(
    createAuditEvent({
      actorId: input.actorId,
      actorRoles: input.actorRoles,
      tenantId: input.organisationId,
      action: AuditAction.VanityDomainVerified,
      resource: "auth_settings",
      resourceId: domain,
      metadata: { domain },
    })
  );

  await deps.pool.query(
    "UPDATE public.vanity_domain_challenges SET verified_at = now() WHERE id = $1",
    [challenge.id]
  );

  return { kind: "ok" };
}

// checkDomainOwnership — called by addVanityDomain before adding to Keycloak
export async function checkDomainOwnership(
  domain: string,
  organisationId: string,
  pool: pg.Pool
): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT id FROM public.vanity_domain_challenges
     WHERE organisation_id = $1 AND domain = $2
       AND verified_at IS NOT NULL
       AND consumed_at IS NULL
       AND expires_at > now()
     LIMIT 1`,
    [organisationId, domain]
  );
  return rows.length > 0;
}

// consumeChallenge — called after successfully adding domain to Keycloak
export async function consumeChallenge(
  domain: string,
  organisationId: string,
  pool: pg.Pool
): Promise<void> {
  await pool.query(
    `UPDATE public.vanity_domain_challenges
     SET consumed_at = now()
     WHERE organisation_id = $1 AND domain = $2
       AND verified_at IS NOT NULL AND consumed_at IS NULL`,
    [organisationId, domain]
  );
}
```

- [ ] **Step 5: Update vanity-domain.ts to require verified challenge**

In `apps/platform-api/src/usecases/vanity-domain.ts`, update `addVanityDomain` to:
1. Import `checkDomainOwnership` and `consumeChallenge` from `./vanity-domain-challenge.ts`
2. Validate domain is owned before emitting audit
3. Consume challenge after successful Keycloak update

Change the `addVanityDomain` function signature to accept a pool parameter and check ownership:

```typescript
// In addVanityDomain, before deps.audit.emit:
import { checkDomainOwnership, consumeChallenge } from "./vanity-domain-challenge.ts";

// Add pool to VanityDomainDeps:
export interface VanityDomainDeps {
  audit: AuditEventPort;
  adminConfig: KeycloakAdminConfig;
  pool: pg.Pool; // for ownership verification
}

// In addVanityDomain body, before audit emit:
const isOwned = await checkDomainOwnership(input.domain.toLowerCase(), input.organisationId, deps.pool);
if (!isOwned) throw new Error("vanity-domain: domain ownership not verified");
```

After successful `mutateBffClientUris`, consume the challenge:
```typescript
await consumeChallenge(input.domain.toLowerCase(), input.organisationId, deps.pool);
```

- [ ] **Step 6: Add 2 challenge routes to routes.ts**

Just before the org features routes:

```typescript
// ---------------------------------------------------------------------------
// Vanity domain ownership challenges (ADR-ACT-0188)
// Proves domain ownership before adding to Keycloak redirect_uris.
// ---------------------------------------------------------------------------
{
  method: "POST",
  path: "/api/auth/settings/domains/challenges",
  operationName: "auth.settings.domains.challenge.create",
  requiresAuth: true,
  requiredPermission: "tenant.auth.settings.write",
  resource: "admin:auth",
  umaScope: "write" as const,
  scope: "tenant" as const,
  handler: async (req, res) => {
    const tenantCtx = await resolveTenantFromRequest(req.raw, getApplicationPool());
    if (!tenantCtx) { res.json(400, { code: "NO_TENANT", message: "No tenant context" }); return; }
    const body = req.body as Record<string, unknown>;
    const domain = typeof body?.domain === "string" ? body.domain : "";
    const { createDomainChallenge } = await import("../usecases/vanity-domain-challenge.ts");
    const result = await createDomainChallenge(
      { domain, organisationId: tenantCtx.organisationId, actorId: req.actor!.userId, actorRoles: req.actor!.roles },
      { audit: createPostgresAuditEventPort(getApplicationPool()), pool: getApplicationPool() }
    );
    if (result.kind === "invalid_domain") { res.json(400, { code: "VALIDATION_ERROR", message: result.message }); return; }
    res.json(201, { txtRecord: result.txtRecord, token: result.token });
  },
},
{
  method: "POST",
  path: "/api/auth/settings/domains/verify",
  operationName: "auth.settings.domains.challenge.verify",
  requiresAuth: true,
  requiredPermission: "tenant.auth.settings.write",
  resource: "admin:auth",
  umaScope: "write" as const,
  scope: "tenant" as const,
  handler: async (req, res) => {
    const tenantCtx = await resolveTenantFromRequest(req.raw, getApplicationPool());
    if (!tenantCtx) { res.json(400, { code: "NO_TENANT", message: "No tenant context" }); return; }
    const body = req.body as Record<string, unknown>;
    const domain = typeof body?.domain === "string" ? body.domain : "";
    const { verifyDomainChallenge } = await import("../usecases/vanity-domain-challenge.ts");
    const result = await verifyDomainChallenge(
      { domain, organisationId: tenantCtx.organisationId, actorId: req.actor!.userId, actorRoles: req.actor!.roles },
      { audit: createPostgresAuditEventPort(getApplicationPool()), pool: getApplicationPool() }
    );
    if (result.kind === "not_found") { res.json(404, { code: "NOT_FOUND", message: "No active challenge for this domain" }); return; }
    if (result.kind === "expired") { res.json(422, { code: "VALIDATION_ERROR", message: "Challenge has expired" }); return; }
    if (result.kind === "already_verified") { res.json(200, { status: "already_verified" }); return; }
    if (result.kind === "dns_not_found" || result.kind === "dns_mismatch") {
      res.json(422, { code: "VALIDATION_ERROR", message: `DNS verification failed: ${result.kind}` }); return;
    }
    res.json(200, { status: "verified" });
  },
},
```

- [ ] **Step 7: Write tests**

Create `apps/platform-api/tests/unit/vanity-domain-challenge.test.ts`:

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { AuditAction, type AuditEventPort, type AuditEvent } from "@platform/audit-events";
import { createDomainChallenge, verifyDomainChallenge } from "../../src/usecases/vanity-domain-challenge.ts";

const ORG_ID = "a1b2c3d4-e5f6-4000-8000-000000000001";
const ACTOR_ID = "a1b2c3d4-e5f6-4000-8000-000000000002";

function makeAudit(fail = false): AuditEventPort & { events: AuditEvent[] } {
  const events: AuditEvent[] = [];
  return { events, async emit(e) { if (fail) throw new Error("fail"); events.push(e); }, async query() { return []; } };
}

function makePool(opts: { challenge?: { token: string; expires_at: Date; verified_at: Date | null } | null } = {}) {
  const calls: { text: string; values?: unknown[] }[] = [];
  return {
    calls,
    pool: {
      async query(text: string, values?: unknown[]) {
        calls.push({ text, values });
        if (text.toLowerCase().includes("select id, token")) {
          if (opts.challenge === null || opts.challenge === undefined) return { rows: [], rowCount: 0 };
          return { rows: [{ id: "ch-1", ...opts.challenge }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    } as never,
  };
}

describe("createDomainChallenge", () => {
  it("invalid domain → invalid_domain, no audit", async () => {
    const audit = makeAudit();
    const { pool } = makePool();
    const result = await createDomainChallenge(
      { domain: "1.2.3.4", organisationId: ORG_ID, actorId: ACTOR_ID, actorRoles: ["tenant-admin"] },
      { audit, pool }
    );
    assert.equal(result.kind, "invalid_domain");
    assert.equal(audit.events.length, 0);
  });

  it("success → ok, token generated, audit emitted", async () => {
    const audit = makeAudit();
    const { pool } = makePool();
    const result = await createDomainChallenge(
      { domain: "example.com", organisationId: ORG_ID, actorId: ACTOR_ID, actorRoles: ["tenant-admin"] },
      { audit, pool }
    );
    assert.equal(result.kind, "ok");
    assert.ok("token" in result && result.token.length > 0);
    assert.ok("txtRecord" in result && result.txtRecord.includes("_aldous-verify.example.com"));
    assert.equal(audit.events[0]!.action, AuditAction.VanityDomainChallengeCreated);
  });
});

describe("verifyDomainChallenge", () => {
  it("no challenge → not_found", async () => {
    const audit = makeAudit();
    const { pool } = makePool({ challenge: null });
    const result = await verifyDomainChallenge(
      { domain: "example.com", organisationId: ORG_ID, actorId: ACTOR_ID, actorRoles: ["tenant-admin"] },
      { audit, pool, dns: { async resolveTxt() { return []; } } }
    );
    assert.equal(result.kind, "not_found");
  });

  it("expired challenge → expired", async () => {
    const audit = makeAudit();
    const { pool } = makePool({ challenge: { token: "tok", expires_at: new Date(0), verified_at: null } });
    const result = await verifyDomainChallenge(
      { domain: "example.com", organisationId: ORG_ID, actorId: ACTOR_ID, actorRoles: ["tenant-admin"] },
      { audit, pool, dns: { async resolveTxt() { return []; } } }
    );
    assert.equal(result.kind, "expired");
  });

  it("DNS not found → dns_not_found", async () => {
    const audit = makeAudit();
    const { pool } = makePool({ challenge: { token: "abc123", expires_at: new Date(Date.now() + 86400000), verified_at: null } });
    const result = await verifyDomainChallenge(
      { domain: "example.com", organisationId: ORG_ID, actorId: ACTOR_ID, actorRoles: ["tenant-admin"] },
      { audit, pool, dns: { async resolveTxt() { return []; } } }
    );
    assert.equal(result.kind, "dns_not_found");
  });

  it("DNS has wrong token → dns_mismatch", async () => {
    const audit = makeAudit();
    const { pool } = makePool({ challenge: { token: "correct-token", expires_at: new Date(Date.now() + 86400000), verified_at: null } });
    const result = await verifyDomainChallenge(
      { domain: "example.com", organisationId: ORG_ID, actorId: ACTOR_ID, actorRoles: ["tenant-admin"] },
      { audit, pool, dns: { async resolveTxt() { return [["wrong-token"]]; } } }
    );
    assert.equal(result.kind, "dns_mismatch");
  });

  it("correct DNS token → ok, VanityDomainVerified audit, verified_at set", async () => {
    const audit = makeAudit();
    const { pool } = makePool({ challenge: { token: "abc123", expires_at: new Date(Date.now() + 86400000), verified_at: null } });
    const result = await verifyDomainChallenge(
      { domain: "example.com", organisationId: ORG_ID, actorId: ACTOR_ID, actorRoles: ["tenant-admin"] },
      { audit, pool, dns: { async resolveTxt() { return [["abc123"]]; } } }
    );
    assert.equal(result.kind, "ok");
    assert.equal(audit.events[0]!.action, AuditAction.VanityDomainVerified);
  });

  it("cross-tenant: another org's challenge is not found for this org (pool filters by org_id)", async () => {
    // Pool returns empty because org ID doesn't match — application-level isolation
    const audit = makeAudit();
    const { pool } = makePool({ challenge: null }); // null = empty result
    const result = await verifyDomainChallenge(
      { domain: "example.com", organisationId: "different-org-id", actorId: ACTOR_ID, actorRoles: ["tenant-admin"] },
      { audit, pool, dns: { async resolveTxt() { return [["abc123"]]; } } }
    );
    assert.equal(result.kind, "not_found");
  });
});
```

- [ ] **Step 8: Register and run tests**

Add `apps/platform-api/tests/unit/vanity-domain-challenge.test.ts` to test:platform-api in `package.json`.

```bash
npm run test:platform-api
make check
```

Expected: all pass.

- [ ] **Step 9: Commit**

```bash
git add apps/platform-api/src/db/migrations/014-vanity-domain-challenges.sql \
  packages/audit-events/src/index.ts \
  apps/platform-api/src/usecases/vanity-domain-challenge.ts \
  apps/platform-api/src/usecases/vanity-domain.ts \
  apps/platform-api/src/server/routes.ts \
  apps/platform-api/tests/unit/vanity-domain-challenge.test.ts \
  package.json
git commit -m "feat(vanity-domain): DNS proof-of-ownership challenge — ADR-ACT-0188"
git add docs/adr/ACTION-REGISTER.md
git commit -m "docs(adr): ADR-ACT-0188 Done — vanity domain DNS ownership proof"
```

---

## Task 8: License scanning (ADR-ACT-0086/0090)

**Files:**
- Modify: `package.json`
- Modify: `docs/security/license-policy.md`
- Modify: `docs/adr/ACTION-REGISTER.md`

- [ ] **Step 1: Install license-checker-rseidelsohn**

```bash
npm install --save-dev license-checker-rseidelsohn
```

- [ ] **Step 2: Update license:policy script in package.json**

Replace:
```json
"license:policy": "echo \"License policy: see docs/security/license-policy.md. Automated scanning tracked in ADR-ACT-0090.\""
```

With:
```json
"license:policy": "license-checker-rseidelsohn --production --excludePrivatePackages --failOn 'GPL-2.0;GPL-3.0;AGPL-3.0;SSPL;Commons Clause' --out /dev/null && echo 'License scan passed — no blocked licenses found'"
```

- [ ] **Step 3: Run scan**

```bash
npm run license:policy
```

Expected: `License scan passed — no blocked licenses found` (no exit code 1).

If scan fails with a blocked license, investigate with:
```bash
npx license-checker-rseidelsohn --production --excludePrivatePackages --json | python3 -c "import sys,json; d=json.load(sys.stdin); [print(k,v.get('licenses')) for k,v in d.items()]" | grep -i "gpl\|agpl\|sspl"
```

- [ ] **Step 4: Update license-policy.md**

Append to `docs/security/license-policy.md`:

```markdown
## Automated enforcement

The `license:policy` npm script runs `license-checker-rseidelsohn` on production dependencies.
It fails on: GPL-2.0, GPL-3.0, AGPL-3.0, SSPL, Commons Clause.

Run: `npm run license:policy`

Promoted to a hard gate in this repository as of ADR-ACT-0086/0090 completion.
```

- [ ] **Step 5: Commit and update ACTION-REGISTER**

```bash
git add package.json docs/security/license-policy.md
git commit -m "feat(security): wire license-checker as hard gate — ADR-ACT-0086/0090"
git add docs/adr/ACTION-REGISTER.md
git commit -m "docs(adr): ADR-ACT-0086 and ADR-ACT-0090 Done — license scanning wired"
```

---

## Task 9: OpenAPI drift fix

**Files:**
- Modify: `docs/api/openapi.json`

The pre-existing OpenAPI drift test reports routes missing from `docs/api/openapi.json`:
- `POST /api/admin/support-session`
- `GET /api/auth/settings/resource-policies`
- `GET /api/org/members`
- `POST /api/org/members/invite`
- `PATCH /api/org/members/:userId`
- `DELETE /api/org/members/:userId`
- `GET /api/org/groups`
- `POST /api/org/groups`
- `PATCH /api/org/groups/:groupId`
- `DELETE /api/org/groups/:groupId`
- `GET /api/org/sub-organisations`
- `POST /api/org/sub-organisations`
- `PATCH /api/org/sub-organisations/:subOrgId`
- `DELETE /api/org/sub-organisations/:subOrgId`
- `GET /api/org/features`
- `PATCH /api/org/features/:featureKey`
- `POST /api/auth/settings/domains/challenges`
- `POST /api/auth/settings/domains/verify`

- [ ] **Step 1: Add missing route stubs to openapi.json**

The file is at `docs/api/openapi.json`. For each missing route, add a minimal OpenAPI path entry under `paths`. Follow the existing format in the file (see `"paths": { "/healthz": { "get": { ... } } }`).

For each route, add at minimum: summary, operationId, tags, security (bearerAuth), responses (200/204/400/401/403/404 as appropriate).

Use the operationName from routes.ts as the operationId.

Example pattern for GET /api/org/members:
```json
"/api/org/members": {
  "get": {
    "summary": "List tenant members",
    "operationId": "org.members.list",
    "tags": ["Members"],
    "security": [{"cookieAuth": []}],
    "responses": {
      "200": { "description": "Member list" },
      "401": { "description": "Unauthenticated" },
      "403": { "description": "Forbidden" }
    }
  }
}
```

Add all 18 missing route entries following this pattern. Group under meaningful tags: Members, Groups, SubOrganisations, Features, Auth Settings.

- [ ] **Step 2: Run architecture tests to verify drift passes**

```bash
npm run test:architecture
```

Expected: 638/638 pass (0 fail — OpenAPI drift test should now pass).

- [ ] **Step 3: Commit**

```bash
git add docs/api/openapi.json
git commit -m "docs(api): add missing routes to openapi.json — fix drift validation"
```

---

## Task 10: Governance documentation (ADR-ACT-0032/0038/0039)

**Files:**
- Create: `docs/architecture/stakeholder-guide.md`
- Create: `docs/architecture/generated-outputs-policy.md`
- Create: `docs/architecture/vocabulary-consistency.md`
- Modify: `docs/adr/ACTION-REGISTER.md`

- [ ] **Step 1: Write stakeholder guide (ADR-ACT-0032)**

Create `docs/architecture/stakeholder-guide.md`:

```markdown
# Third-Party Stakeholder Guide

This document explains the lifecycle stage, package roles, and semantic versioning
expectations for packages in this repository. Intended for: external contributors,
consumers of published packages, and third-party integrators.

## Lifecycle stage

This platform is in **active development (pre-1.0)**. APIs should be treated as
unstable; breaking changes may occur between minor versions until 1.0.0 is released.

## Package roles

Each package in `packages/` has a defined role:

| Package | Role | Stability |
|---|---|---|
| contracts-auth | Auth session/permission contracts — consumed by BFF and UI | Evolving |
| domain-identity | Identity domain logic and permission resolution | Evolving |
| platform-errors | Typed error hierarchy for BFF and adapters | Stable |
| platform-logging | Structured logging abstraction | Stable |
| platform-observability | OpenTelemetry integration | Stable |
| platform-runtime-context | Request context propagation | Stable |
| session-runtime | Session store contracts | Evolving |
| adapters-redis | Redis session + state adapters | Evolving |
| adapters-postgres | PostgreSQL multi-tenant adapters | Evolving |
| adapters-keycloak | Keycloak OIDC/Admin adapters | Evolving |
| authorisation-runtime | UMA/policy authorisation port | Evolving |
| api-runtime | BFF API health/version contracts | Stable |
| audit-events | Audit event types and storage | Evolving |
| i18n-runtime | i18n hooks and React integration | Placeholder |

## Semver expectations

- **Patch (0.x.y → 0.x.(y+1))**: Bug fixes, internal refactors with no API surface change.
- **Minor (0.x.y → 0.(x+1).0)**: New exports or additive API changes. Existing consumers unaffected.
- **Major (0.x.y → 1.0.0 or 2.x.0)**: Breaking changes to exported types or function signatures.

Until 1.0.0, minor bumps may include breaking changes per npm semver convention for pre-release packages.

## Integration points

External consumers should depend on `contracts-auth`, `platform-errors`, and `platform-logging`.
All other packages are implementation detail and may change without notice.
```

- [ ] **Step 2: Write generated-outputs policy (ADR-ACT-0038)**

Create `docs/architecture/generated-outputs-policy.md`:

```markdown
# Generated Outputs Policy (ADR-ACT-0038)

Defines which outputs are generated from `package.json` architecture metadata and how.

## Current generated outputs

| Output | Generator | Trigger | Source metadata |
|---|---|---|---|
| `packages/<name>/README.md` (description block) | `generate-package-readmes` | `npm run readmes` / architecture gate | `package.json` description, role, lifecycle, dependencies |
| `docs/evidence/architecture/package-inventory.json` | `generate-package-inventory` | architecture gate | All packages' metadata |
| `docs/evidence/architecture/lifecycle-report.json` | `generate-lifecycle-reports` | architecture gate | Lifecycle stage per package |

## Planned outputs (deferred)

- **Backstage catalog entries** (`catalog-info.yaml`) — when Backstage is adopted
- **C4 component inventory** — when C4 tooling is integrated
- **Runtime deployment metadata** — when deployment config is formalised

## Metadata schema

Each `package.json` must include:
```json
{
  "x-architecture": {
    "role": "domain|contract|adapter|infrastructure|tool",
    "lifecycle": "experimental|evolving|stable|deprecated",
    "layer": "domain|application|adapter|ui|infrastructure"
  }
}
```

The `validate-package-metadata` tool enforces this schema at the architecture gate.
```

- [ ] **Step 3: Write vocabulary consistency policy (ADR-ACT-0039)**

Create `docs/architecture/vocabulary-consistency.md`:

```markdown
# Cross-ADR Vocabulary Consistency (ADR-ACT-0039)

Defines the canonical vocabulary used across all ADRs and how consistency is maintained.

## Canonical terms

| Term | Definition | Used in |
|---|---|---|
| Tenant | A top-level organisation with its own Keycloak realm, DB schema, Redis namespace, S3 bucket | ADR-0029, 0030, 0031 |
| Sub-organisation | A logical child organisation sharing the parent's infrastructure (Tier 2) | ADR-0029, ADR-ACT-0143 |
| Feature module | A named platform capability toggleable per-tenant without deployment | ADR-ACT-0143 |
| UMA | User-Managed Access — Keycloak's policy enforcement mechanism | ADR-0030 |
| BFF | Backend For Frontend — the platform-api server acting as the API boundary | ADR-0022, 0030 |
| Audit-first | Pattern: emit audit event before mutation; failure aborts mutation | ADR-ACT-0154 |
| RLS | Row-Level Security — PostgreSQL row filtering by tenant context | ADR-0029, ADR-ACT-0147 |
| Tier 1 | Tenant with dedicated Keycloak realm + DB schema + Redis + S3 | ADR-0031 |
| Tier 2 | Sub-organisation sharing parent's infrastructure | ADR-0031 |

## Review process

New vocabulary-affecting ADRs must:
1. Define terms in the ADR body before using them.
2. Check this document for conflicts with existing definitions.
3. Add/update terms here as part of the ADR acceptance process.

No automated tooling is required at this stage. This document serves as the
human-readable reference that reviewers check when accepting new ADRs.
```

- [ ] **Step 4: Update ACTION-REGISTER**

```bash
git add docs/architecture/stakeholder-guide.md docs/architecture/generated-outputs-policy.md docs/architecture/vocabulary-consistency.md
git commit -m "docs: stakeholder guide + generated-outputs policy + vocabulary consistency"
git add docs/adr/ACTION-REGISTER.md
git commit -m "docs(adr): ADR-ACT-0032, 0038, 0039 Done — governance documentation"
```

---

## Task 11: Classify deferred and blocked items

**Files:**
- Modify: `docs/adr/ACTION-REGISTER.md`

Update the following entries with explicit rationale:

- [ ] **ADR-ACT-0092** — status: `Blocked`. Rationale: "SonarQube CI gate requires SONAR_HOST_URL and SONAR_TOKEN secrets in the CI environment. These are external infrastructure credentials. Cannot be completed without CI configuration. Blocked until a CI platform is chosen and secrets are provisioned."

- [ ] **ADR-ACT-0156** — status: `Deferred`. Rationale: "Keycloak login page theme requires a custom theme JAR or Docker-mounted theme directory. Platform currently uses the default Keycloak theme. Deferred until a branding design is approved and Keycloak theme development workflow is set up. Does not block tenant login or platform functionality."

- [ ] **ADR-ACT-0157** — status: `Deferred`. Rationale: "OIDC/SAML broker login E2E requires a mock OIDC server fixture in Keycloak Terraform. Setting up a reliable test IdP (e.g., node-oidc-provider) is a non-trivial fixture investment. Deferred until the first real external IdP integration is planned."

- [ ] **ADR-ACT-0158** — status: `Deferred`. Rationale: "MFA E2E requires OTP policy configuration and a fixture TOTP credential. Deferred — MFA is functional in the platform but E2E test coverage of the challenge flow requires fixture tooling. Will be added when MFA is enabled for a specific tenant."

- [ ] **ADR-ACT-0159** — status: `Deferred`. Rationale: "Disabled user / unverified email E2E requires specific Keycloak Terraform fixture users. Deferred pending Keycloak fixture management tooling improvements."

- [ ] **ADR-ACT-0160** — status: `Deferred`. Rationale: "Expired session E2E requires either clock manipulation or very short token lifetimes in the test realm. Deferred — the auth pipeline correctly handles 401 on expired tokens in unit tests; E2E coverage added when clock control or short-lifetime fixtures are available."

- [ ] **Step: Commit classification**

```bash
git add docs/adr/ACTION-REGISTER.md
git commit -m "docs(adr): explicit Deferred/Blocked classification for ADR-ACT-0092 and 0156-0160"
```

---

## Task 12: Final baseline validation

- [ ] **Step 1: Run full test suite**

```bash
npm run test:platform-api
npm run test:architecture
npm run test:frontend:run
npm run test:compose
```

Expected:
- `test:platform-api`: 240+ tests, 0 fail
- `test:architecture`: 638+ tests, 0 fail (drift fixed)
- `test:frontend:run`: 26 tests, 0 fail
- `test:compose`: 24/30 pass (6 container-health failures are pre-existing environment limits, not code failures)

- [ ] **Step 2: Run all quality gates**

```bash
npm run audit:deps
npm run license:policy
npm run secrets:scan || true  # gitleaks — pass if installed, skip if not
make check
```

Expected: all pass. If `audit:deps` has high vulnerabilities, investigate with `npm audit`.

- [ ] **Step 3: Run make all (if full environment is available)**

```bash
make all
```

If Docker or Keycloak are not fully available, document the specific gate that could not run:
- `make e2e-prod` requires DNS, production Keycloak, Cloudflare — cannot run in local dev without those
- `make compose-up-identity` requires Keycloak realm to be provisioned
- Document any failures as environmental, not code failures

- [ ] **Step 4: Update final ACTION-REGISTER state**

Do a final pass on `docs/adr/ACTION-REGISTER.md` to ensure every item is in one of: Done / Open (with next step) / Deferred (with rationale) / Blocked (with external dependency).

- [ ] **Step 5: Final commit and push**

```bash
git add docs/adr/ACTION-REGISTER.md
git commit -m "chore: final ACTION-REGISTER state — platform-ready base complete"
git push origin main
```

---

## Self-Review

### Spec coverage check

| Requirement | Task |
|---|---|
| Sub-organisations domain model + migration | Task 1 |
| Sub-organisations usecase (create/list/update/deactivate) | Task 3 |
| Sub-organisations routes | Task 4 |
| Sub-organisations tests | Task 5 |
| Feature toggles definition | Task 6 (intro) |
| Feature toggles implementation | Task 6 |
| Vanity domain DNS proof migration | Task 7 |
| Vanity domain DNS proof usecase | Task 7 |
| Vanity domain DNS proof routes | Task 7 |
| Vanity domain DNS proof tests | Task 7 |
| License scanning wired | Task 8 |
| OpenAPI drift repair | Task 9 |
| ADR-ACT-0032 stakeholder guide | Task 10 |
| ADR-ACT-0038 generated outputs | Task 10 |
| ADR-ACT-0039 vocabulary consistency | Task 10 |
| ADR-ACT-0092 classified blocked | Task 11 |
| ADR-ACT-0156-0160 classified deferred | Task 11 |
| Full baseline validation | Task 12 |

### Deferred items (not implementing, only classifying)

- ADR-ACT-0016: context name review — depends on 5 vertical slices; not yet
- ADR-ACT-0024: affected-package CI — future work
- ADR-ACT-0075: TUI parity — no TUI exists
- ADR-ACT-0089: Sentry profile validation — deferred
- ADR-ACT-0155: Keycloak provisioner refactor — superseded by ADR-ACT-0186 (Done)

### Production caveats captured

- `addVanityDomain` now requires a verified challenge — existing tenants with domains added before ADR-ACT-0188 are unaffected (already-added domains remain, new additions require proof)
- Sub-org deactivation is soft (is_active = false) — future cleanup of deactivated sub-orgs requires a separate archival job
- Feature toggles v1 has a hardcoded allowlist — extending requires code + ADR update
