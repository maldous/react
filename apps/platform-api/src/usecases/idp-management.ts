import type { IdentityProvider } from "@platform/authorisation-runtime";
import type { IdpSummary, CreateIdpRequest, UpdateIdpRequest } from "@platform/contracts-admin";

// ---------------------------------------------------------------------------
// Identity Provider management mappers (ADR-0043 / ADR-ACT-0211)
//
// Pure functions that translate between the redacted DTO boundary and the
// internal Keycloak IdentityProvider representation. The SPA never sees the raw
// representation, and clientSecret is never returned in a summary or audit.
//
// Keycloak masks clientSecret as "**********" on read; re-PUTing the mask
// preserves the stored secret (the same round-trip its admin console uses), so a
// blank/absent secret on update keeps the existing one.
// ---------------------------------------------------------------------------

const URL_CONFIG_KEYS = ["authorizationUrl", "tokenUrl", "userInfoUrl", "issuer"] as const;

/** Explicit, redacted mapping — never passes raw config or the secret value through. */
export function toIdpSummary(raw: IdentityProvider): IdpSummary {
  const config = raw.config ?? {};
  const clientSecret = config["clientSecret"];
  const clientId = config["clientId"];
  const scopes = config["defaultScope"];
  return {
    alias: raw.alias,
    displayName: raw.displayName ?? raw.alias,
    providerId: raw.providerId,
    enabled: Boolean(raw.enabled),
    trustEmail: Boolean(raw.trustEmail),
    hasClientSecret: typeof clientSecret === "string" && clientSecret.length > 0,
    clientId: typeof clientId === "string" && clientId.length > 0 ? clientId : null,
    scopes: typeof scopes === "string" && scopes.length > 0 ? scopes : null,
  };
}

/** Build the Keycloak representation for a create request. */
export function buildCreateRepresentation(req: CreateIdpRequest): IdentityProvider {
  const config: Record<string, string> = {
    clientId: req.clientId,
    clientSecret: req.clientSecret,
  };
  if (req.authorizationUrl) config["authorizationUrl"] = req.authorizationUrl;
  if (req.tokenUrl) config["tokenUrl"] = req.tokenUrl;
  if (req.userInfoUrl) config["userInfoUrl"] = req.userInfoUrl;
  if (req.issuer) config["issuer"] = req.issuer;
  if (req.scopes) config["defaultScope"] = req.scopes;
  return {
    alias: req.alias,
    displayName: req.displayName,
    providerId: req.providerId,
    enabled: req.enabled,
    trustEmail: req.trustEmail,
    config,
  };
}

/**
 * Merge an update request onto the existing representation. A blank/absent
 * clientSecret leaves `config.clientSecret` as Keycloak returned it (the mask),
 * which preserves the stored secret on PUT. A non-empty clientSecret overwrites.
 */
export function applyUpdate(existing: IdentityProvider, req: UpdateIdpRequest): IdentityProvider {
  const config: Record<string, string> = { ...(existing.config ?? {}) };
  if (req.clientId !== undefined) config["clientId"] = req.clientId;
  if (req.clientSecret) config["clientSecret"] = req.clientSecret; // only when non-empty
  if (req.authorizationUrl !== undefined) config["authorizationUrl"] = req.authorizationUrl;
  if (req.tokenUrl !== undefined) config["tokenUrl"] = req.tokenUrl;
  if (req.userInfoUrl !== undefined) config["userInfoUrl"] = req.userInfoUrl;
  if (req.issuer !== undefined) config["issuer"] = req.issuer;
  if (req.scopes !== undefined) config["defaultScope"] = req.scopes;
  return {
    ...existing,
    displayName: req.displayName ?? existing.displayName,
    enabled: req.enabled ?? existing.enabled,
    trustEmail: req.trustEmail ?? existing.trustEmail,
    config,
  };
}

// --- audit metadata builders (NEVER include clientSecret/tokens/raw config) ---

/** Safe create metadata: alias, providerId, enabled, clientId — no secret. */
export function buildIdpCreateAuditMetadata(req: CreateIdpRequest): Record<string, unknown> {
  return {
    operation: "create",
    alias: req.alias,
    providerId: req.providerId,
    enabled: req.enabled,
    clientId: req.clientId,
    hasClientSecret: Boolean(req.clientSecret),
  };
}

/** Safe update metadata: alias + the NAMES of changed fields. Secret value omitted;
 * we only record whether the secret changed, never its value. */
export function buildIdpUpdateAuditMetadata(
  alias: string,
  req: UpdateIdpRequest
): Record<string, unknown> {
  const changedFields = Object.keys(req).filter(
    (k) => (req as Record<string, unknown>)[k] !== undefined && k !== "clientSecret"
  );
  return {
    operation: "update",
    alias,
    changedFields,
    secretChanged: typeof req.clientSecret === "string" && req.clientSecret.length > 0,
  };
}

export function buildIdpDeleteAuditMetadata(alias: string): Record<string, unknown> {
  return { operation: "delete", alias };
}

/** Whether a write request's config carries an http/https URL only is enforced by
 * the contract schema; this exposes the allowed URL keys for documentation/tests. */
export const IDP_URL_CONFIG_KEYS = URL_CONFIG_KEYS;
