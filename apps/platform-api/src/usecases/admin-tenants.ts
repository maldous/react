// ---------------------------------------------------------------------------
// Admin tenant lookup (ADR-ACT-0255)
//
// A small, read-only, system-operator lookup over the organisation registry so
// operator consoles (e.g. /admin/entitlements) can pick a tenant by slug/name
// instead of pasting a raw UUID. Returns id + slug + display name only — no
// secrets, no tenant-management semantics. Capped (default 50) with a `truncated`
// flag. This is NOT tenant lifecycle (no create/suspend/delete/export here).
// ---------------------------------------------------------------------------

import type { TenantLookupResponse } from "@platform/contracts-admin";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PgPool = { query(text: string, values?: unknown[]): Promise<{ rows: any[] }> };

const MAX = 50;

export async function lookupTenants(
  pool: PgPool,
  query: string | undefined
): Promise<TenantLookupResponse> {
  const q = (query ?? "").trim();
  const like = `%${q}%`;
  const rows = q
    ? await pool.query(
        `SELECT id, slug, display_name FROM public.organisations
           WHERE slug ILIKE $1 OR display_name ILIKE $1
           ORDER BY slug LIMIT ${MAX + 1}`,
        [like]
      )
    : await pool.query(
        `SELECT id, slug, display_name FROM public.organisations ORDER BY slug LIMIT ${MAX + 1}`
      );
  const truncated = rows.rows.length > MAX;
  const tenants = rows.rows.slice(0, MAX).map((r) => ({
    id: r.id as string,
    slug: r.slug as string,
    displayName: r.display_name as string,
  }));
  return { tenants, truncated };
}
