/**
 * Tenant resolution from FQDN ? ADR-0029 ?1, ADR-ACT-0231
 *
 * Resolves the active tenant from the HTTP Host header. Used by both the
 * main request pipeline (to verify session tenant matches FQDN tenant) and
 * the auth flow (to select the correct Keycloak realm per tenant).
 *
 * Host identity (classifyHostIdentity, @platform/domain-identity) is the
 * single classification step; this module maps host identities to tenants:
 *   tenant_slug             ? organisations.slug lookup
 *   custom_domain_candidate ? tenant_domains registry lookup (ADR-ACT-0231):
 *                             resolves ONLY when ownership is DNS-verified AND
 *                             the auth client is activated AND not disabled.
 *   apex / reserved / invalid / malformed ? never a tenant.
 *
 * Security: every host-derived identifier is verified against the database ?
 * a forged header resolves to no tenant and is rejected. Request bodies never
 * confer tenant authority.
 */

import type { IncomingMessage } from "node:http";
import pg from "pg";

import { classifyHostIdentity } from "@platform/domain-identity";

const APEX_DOMAIN = process.env["APEX_DOMAIN"] ?? "aldous.info";

export interface TenantContext {
  slug: string;
  organisationId: string;
  /** Keycloak realm name for this tenant: "tenant-{organisationId}" */
  realmName: string;
  /** Which host identity resolved this tenant (ADR-ACT-0231). */
  hostSource: "slug" | "custom_domain";
}

/**
 * Extract the tenant slug from a hostname.
 * Returns null for the super-global root (aldous.info) or non-matching hosts.
 * Ports are stripped before matching (ADR-ACT-0225).
 */
export function extractSlugFromHost(host: string, apexDomain = APEX_DOMAIN): string | null {
  return classifyHostIdentity(host, apexDomain).slug;
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
  return classifyHostIdentity(host, apexDomain).kind === "apex";
}

/**
 * Returns true when the host is a subdomain of the apex zone — tenant slug,
 * reserved, or invalid. Global-only routes must reject these hosts even when
 * no tenant resolves (ADR-ACT-0231 hardening): an unknown/reserved subdomain
 * shares the apex cookie scope and the wildcard Caddy vhost, so it must never
 * be treated as the global host.
 */
export function isApexSubdomain(host: string, apexDomain = APEX_DOMAIN): boolean {
  const kind = classifyHostIdentity(host, apexDomain).kind;
  return kind === "tenant_slug" || kind === "reserved_subdomain" || kind === "invalid_subdomain";
}

/**
 * Derive the effective request host: X-Forwarded-Host (set by the trusted
 * Caddy/Cloudflare proxy chain — see Caddyfile trusted_proxies) preferred over
 * the raw Host header, comma-split to the first hop. Shared by the pipeline,
 * the auth flow, and the resolver so every consumer sees the same host.
 */
export function requestHostFromHeaders(req: IncomingMessage): string {
  const rawForwardedHost = req.headers["x-forwarded-host"];
  const rawHost = req.headers["host"] ?? "";
  const hostValue =
    (Array.isArray(rawForwardedHost) ? (rawForwardedHost[0] ?? "") : (rawForwardedHost ?? "")) ||
    (Array.isArray(rawHost) ? (rawHost[0] ?? "") : rawHost);
  return hostValue.split(",")[0]?.trim() ?? "";
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
 * Resolve an ACTIVE custom domain to its organisation (ADR-ACT-0231).
 * A custom domain resolves only when its lifecycle row is DNS-ownership
 * verified AND auth-client activated AND not disabled — a verified-but-not-
 * activated domain deliberately does NOT serve tenant traffic.
 */
export async function resolveOrganisationByActiveCustomDomain(
  pool: pg.Pool,
  domain: string
): Promise<{ id: string; slug: string } | null> {
  try {
    const { rows } = await pool.query<{ id: string; slug: string }>(
      `SELECT o.id, o.slug
         FROM public.tenant_domains td
         JOIN public.organisations o ON o.id = td.organisation_id
        WHERE td.domain = $1
          AND td.ownership_status = 'verified'
          AND td.auth_client_status = 'active'
          AND td.disabled_at IS NULL
        LIMIT 1`,
      [domain]
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
 *   - The host is a reserved/invalid/malformed subdomain
 *   - The slug does not exist in the database
 *   - The host is a custom domain that is not verified+activated in the registry
 */
export async function resolveTenantFromRequest(
  req: IncomingMessage,
  pool: pg.Pool
): Promise<TenantContext | null> {
  const host = requestHostFromHeaders(req);
  const identity = classifyHostIdentity(host, APEX_DOMAIN);

  if (identity.kind === "tenant_slug" && identity.slug) {
    const org = await resolveOrganisationBySlug(pool, identity.slug);
    if (!org) return null;
    return {
      slug: org.slug,
      organisationId: org.id,
      realmName: `tenant-${org.id}`,
      hostSource: "slug",
    };
  }

  if (identity.kind === "custom_domain_candidate") {
    const org = await resolveOrganisationByActiveCustomDomain(pool, identity.hostname);
    if (!org) return null;
    return {
      slug: org.slug,
      organisationId: org.id,
      realmName: `tenant-${org.id}`,
      hostSource: "custom_domain",
    };
  }

  return null;
}
