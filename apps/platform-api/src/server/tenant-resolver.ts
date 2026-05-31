/**
 * Tenant resolution from FQDN ? ADR-0029 ?1
 *
 * Resolves the active tenant from the HTTP Host header. Used by both the
 * main request pipeline (to verify session tenant matches FQDN tenant) and
 * the auth flow (to select the correct Keycloak realm per tenant).
 *
 * Security: the slug derived from the Host header is always verified against
 * the database ? a forged header resolves to no tenant and is rejected.
 */

import type { IncomingMessage } from "node:http";
import pg from "pg";

import { isSlugReserved } from "@platform/domain-identity";

const APEX_DOMAIN = process.env["APEX_DOMAIN"] ?? "aldous.info";

export interface TenantContext {
  slug: string;
  organisationId: string;
  /** Keycloak realm name for this tenant: "tenant-{organisationId}" */
  realmName: string;
}

/**
 * Extract the tenant slug from a hostname.
 * Returns null for the super-global root (aldous.info) or non-matching hosts.
 */
export function extractSlugFromHost(host: string, apexDomain = APEX_DOMAIN): string | null {
  if (!host.endsWith(`.${apexDomain}`) && host !== apexDomain) return null;
  if (host === apexDomain) return null;
  const slug = host.slice(0, host.length - apexDomain.length - 1);
  if (isSlugReserved(slug)) return null;
  return slug.length > 0 && /^[a-z0-9-]+$/.test(slug) ? slug : null;
}

/**
 * Returns true when the given host is the apex (global) host for the configured
 * APEX_DOMAIN. Used by pipeline scope enforcement to distinguish global routes
 * (aldous.info) from tenant routes ({slug}.aldous.info).
 *
 * One runtime per environment — production uses APEX_DOMAIN=aldous.info,
 * staging uses APEX_DOMAIN=staging.aldous.info. The two environments are
 * never served by a single runtime instance.
 */
export function isGlobalHost(host: string, apexDomain = APEX_DOMAIN): boolean {
  const bare = host.split(":")[0] ?? host; // strip port if present
  return bare === apexDomain;
}

/**
 * Resolve a tenant slug to its organisation record.
 * Returns null when the slug is not found in the database.
 */
export async function resolveOrganisationBySlug(
  pool: pg.Pool,
  slug: string
): Promise<{ id: string; slug: string } | null> {
  try {
    const { rows } = await pool.query<{ id: string; slug: string }>(
      "SELECT id, slug FROM public.organisations WHERE slug = $1 LIMIT 1",
      [slug]
    );
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

/**
 * Resolve the full tenant context from an HTTP request's Host header.
 * Returns null when:
 *   - The host is the super-global root (aldous.info)
 *   - The slug does not exist in the database
 *   - The host does not match the apex domain
 */
export async function resolveTenantFromRequest(
  req: IncomingMessage,
  pool: pg.Pool
): Promise<TenantContext | null> {
  const hostHeader = req.headers["host"] ?? "";
  const host = Array.isArray(hostHeader) ? (hostHeader[0] ?? "") : hostHeader;
  const slug = extractSlugFromHost(host);
  if (!slug) return null;

  const org = await resolveOrganisationBySlug(pool, slug);
  if (!org) return null;

  return {
    slug,
    organisationId: org.id,
    realmName: `tenant-${org.id}`,
  };
}
