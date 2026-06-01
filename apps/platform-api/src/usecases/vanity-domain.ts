import { createAuditEvent, type AuditEventPort } from "@platform/audit-events";
import type { KeycloakAdminConfig } from "@platform/adapters-keycloak";

export interface VanityDomainInput {
  organisationId: string;
  realmName: string;
  actorId: string;
  actorRoles: string[];
  domain: string;
}

export interface VanityDomainDeps {
  audit: AuditEventPort;
  adminConfig: KeycloakAdminConfig;
}

/**
 * Add a vanity domain to a tenant's BFF client redirect_uris and web_origins.
 * No deployment required — Keycloak updates take effect immediately.
 * Audit emitted before Keycloak mutation (ADR-ACT-0154 pattern).
 */
export async function addVanityDomain(
  input: VanityDomainInput,
  deps: VanityDomainDeps
): Promise<void> {
  validateDomain(input.domain);
  await deps.audit.emit(
    createAuditEvent({
      actorId: input.actorId,
      actorRoles: input.actorRoles,
      tenantId: input.organisationId,
      action: "auth_settings.vanity_domain.added",
      resource: "vanity_domain",
      resourceId: input.domain,
      metadata: { domain: input.domain, realmName: input.realmName },
    })
  );
  await mutateBffClientUris(input.realmName, input.domain, "add", deps.adminConfig);
}

/**
 * Remove a vanity domain from a tenant's BFF client redirect_uris and web_origins.
 */
export async function removeVanityDomain(
  input: VanityDomainInput,
  deps: VanityDomainDeps
): Promise<void> {
  validateDomain(input.domain);
  await deps.audit.emit(
    createAuditEvent({
      actorId: input.actorId,
      actorRoles: input.actorRoles,
      tenantId: input.organisationId,
      action: "auth_settings.vanity_domain.removed",
      resource: "vanity_domain",
      resourceId: input.domain,
      metadata: { domain: input.domain, realmName: input.realmName },
    })
  );
  await mutateBffClientUris(input.realmName, input.domain, "remove", deps.adminConfig);
}

// Validates a vanity domain hostname before it is added to Keycloak redirect_uris.
// Does NOT verify ownership — the caller must hold a separate proof-of-ownership
// step (ADR-ACT-0188) before persisting. This function only rejects syntactically
// invalid or trivially abusable hostnames.
function validateDomain(domain: string): void {
  // Lowercase, max 253 chars overall, at least one dot (requires a TLD)
  const lower = domain.toLowerCase();
  if (lower.length > 253 || !lower.includes(".")) {
    throw new Error(`vanity-domain: invalid domain format: ${domain}`);
  }
  // Each label: 1–63 chars, alphanumeric or internal hyphens, no leading/trailing hyphen
  const labelRe = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
  const labels = lower.split(".");
  for (const label of labels) {
    if (!label || !labelRe.test(label)) {
      throw new Error(`vanity-domain: invalid domain format: ${domain}`);
    }
  }
  // Reject IP literals (all-numeric labels with no letters, e.g. 1.2.3.4)
  if (labels.every((l) => /^\d+$/.test(l))) {
    throw new Error(`vanity-domain: IP literals are not allowed: ${domain}`);
  }
}

async function getAdminToken(cfg: KeycloakAdminConfig): Promise<string> {
  const res = await fetch(`${cfg.url}/realms/master/protocol/openid-connect/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: cfg.adminClientId,
      client_secret: cfg.adminClientSecret,
    }),
  });
  if (!res.ok) throw new Error(`vanity-domain: admin token fetch failed: ${res.status}`);
  const data = (await res.json()) as { access_token: string };
  return data.access_token;
}

async function mutateBffClientUris(
  realmName: string,
  domain: string,
  action: "add" | "remove",
  cfg: KeycloakAdminConfig
): Promise<void> {
  const token = await getAdminToken(cfg);
  const baseUrl = `${cfg.url}/admin/realms/${realmName}`;

  const clientsRes = await fetch(`${baseUrl}/clients?clientId=platform-api&max=1`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!clientsRes.ok) throw new Error(`vanity-domain: client lookup failed: ${clientsRes.status}`);
  const clients = (await clientsRes.json()) as Array<{
    id: string;
    redirectUris: string[];
    webOrigins: string[];
  }>;
  const client = clients[0];
  if (!client) throw new Error("vanity-domain: BFF client not found");

  const newUri = `https://${domain}/auth/callback`;
  const newOrigin = `https://${domain}`;
  let redirectUris = client.redirectUris ?? [];
  let webOrigins = client.webOrigins ?? [];

  if (action === "add") {
    if (!redirectUris.includes(newUri)) redirectUris = [...redirectUris, newUri];
    if (!webOrigins.includes(newOrigin)) webOrigins = [...webOrigins, newOrigin];
  } else {
    redirectUris = redirectUris.filter((u) => u !== newUri);
    webOrigins = webOrigins.filter((o) => o !== newOrigin);
  }

  const updateRes = await fetch(`${baseUrl}/clients/${client.id}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ ...client, redirectUris, webOrigins }),
  });
  if (!updateRes.ok) throw new Error(`vanity-domain: client update failed: ${updateRes.status}`);
}
