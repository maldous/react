import type { IdentityProvider } from "@platform/authorisation-runtime";
import { AuditAction, createAuditEvent, type AuditEventPort } from "@platform/audit-events";
import {
  OidcDiscoverRequestSchema,
  type IdpCallbackUrlResponse,
  type OidcConnectionResult,
  type OidcDiscoverResponse,
  type OidcDiscoveryMetadata,
  type OidcValidationResult,
} from "@platform/contracts-admin";

// ---------------------------------------------------------------------------
// OIDC discovery import, issuer/JWKS validation, callback display, test
// connection (ADR-0046 / ADR-ACT-0215).
//
// The BFF performs the outbound fetch itself so we control the timeout, a
// response size cap, and an HTTPS-only-outside-local scheme policy. Only a
// MINIMAL redacted projection of the discovery document ever leaves this layer
// — never the raw document, never a client secret. All probe results are
// classified (ok / issuer_mismatch / jwks_invalid / unreachable /
// invalid_document / not_configured); upstream/network failures never surface
// as a 500.
// ---------------------------------------------------------------------------

export const DISCOVERY_TIMEOUT_MS = 5_000;
export const DISCOVERY_MAX_BYTES = 256 * 1024;

/** Outcome of a single bounded outbound GET — purely classifiable by the use case. */
export type OidcFetchOutcome =
  | { kind: "ok"; json: unknown }
  | { kind: "http_error"; status: number }
  | { kind: "too_large" }
  | { kind: "not_json" }
  | { kind: "network_error" };

/** Port for the bounded outbound fetch. The route wires a real fetch-based impl;
 * tests inject a deterministic fake. */
export interface OidcHttpFetcher {
  get(url: string, opts: { timeoutMs: number; maxBytes: number }): Promise<OidcFetchOutcome>;
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "host.docker.internal"]);

/** http is permitted only for local/dev hosts; everything else must be https. */
export function isAllowedDiscoveryUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol === "https:") return true;
  if (u.protocol !== "http:") return false;
  const host = u.hostname.toLowerCase();
  return LOCAL_HOSTS.has(host) || host.endsWith(".localhost") || host.endsWith(".local");
}

function trimTrailingSlashes(s: string): string {
  let out = s;
  while (out.endsWith("/")) out = out.slice(0, -1);
  return out;
}

/** Compose the discovery URL from an explicit discoveryUrl or `<issuer>/.well-known/...`. */
export function resolveDiscoveryUrl(input: {
  issuer?: string;
  discoveryUrl?: string;
}): string | null {
  if (input.discoveryUrl) return input.discoveryUrl;
  if (input.issuer) return `${trimTrailingSlashes(input.issuer)}/.well-known/openid-configuration`;
  return null;
}

/** Issuers compare exactly except for an insignificant trailing slash. */
function issuerMatches(a: string, b: string): boolean {
  return trimTrailingSlashes(a) === trimTrailingSlashes(b);
}

function asString(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function fail(result: OidcConnectionResult): { validation: OidcValidationResult; metadata: null } {
  return {
    validation: { result, issuerValid: false, jwksValid: false, jwksKeyCount: 0 },
    metadata: null,
  };
}

/**
 * Core probe: fetch + validate a discovery document and (when the issuer matches)
 * its JWKS. `expectedIssuer` is set for test-connection (the stored issuer must
 * match the document) and left undefined for a fresh discovery import.
 */
export async function probeOidcDiscovery(
  params: { discoveryUrl: string; expectedIssuer?: string },
  deps: { fetcher: OidcHttpFetcher }
): Promise<{ validation: OidcValidationResult; metadata: OidcDiscoveryMetadata | null }> {
  if (!isAllowedDiscoveryUrl(params.discoveryUrl)) return fail("unreachable");

  const disco = await deps.fetcher.get(params.discoveryUrl, {
    timeoutMs: DISCOVERY_TIMEOUT_MS,
    maxBytes: DISCOVERY_MAX_BYTES,
  });
  if (disco.kind === "network_error" || disco.kind === "http_error" || disco.kind === "too_large") {
    return fail("unreachable");
  }
  if (disco.kind === "not_json" || typeof disco.json !== "object" || disco.json === null) {
    return fail("invalid_document");
  }

  const doc = disco.json as Record<string, unknown>;
  const issuer = asString(doc["issuer"]);
  const authorizationEndpoint = asString(doc["authorization_endpoint"]);
  const tokenEndpoint = asString(doc["token_endpoint"]);
  const userInfoEndpoint = asString(doc["userinfo_endpoint"]);
  const jwksUri = asString(doc["jwks_uri"]);

  if (!issuer || !authorizationEndpoint || !tokenEndpoint || !jwksUri) {
    return fail("invalid_document");
  }
  if (
    !isAllowedDiscoveryUrl(authorizationEndpoint) ||
    !isAllowedDiscoveryUrl(tokenEndpoint) ||
    !isAllowedDiscoveryUrl(jwksUri)
  ) {
    return fail("invalid_document");
  }
  if (params.expectedIssuer && !issuerMatches(issuer, params.expectedIssuer)) {
    return {
      validation: {
        result: "issuer_mismatch",
        issuerValid: false,
        jwksValid: false,
        jwksKeyCount: 0,
      },
      metadata: null,
    };
  }

  const metadata: OidcDiscoveryMetadata = {
    issuer,
    authorizationEndpoint,
    tokenEndpoint,
    userInfoEndpoint: userInfoEndpoint ?? null,
    jwksUri,
  };

  // JWKS usability: ≥1 key with a key type.
  const jwksRes = await deps.fetcher.get(jwksUri, {
    timeoutMs: DISCOVERY_TIMEOUT_MS,
    maxBytes: DISCOVERY_MAX_BYTES,
  });
  let jwksKeyCount = 0;
  if (jwksRes.kind === "ok" && typeof jwksRes.json === "object" && jwksRes.json !== null) {
    const keys = (jwksRes.json as Record<string, unknown>)["keys"];
    if (Array.isArray(keys)) {
      jwksKeyCount = keys.filter(
        (k) =>
          k && typeof k === "object" && typeof (k as Record<string, unknown>)["kty"] === "string"
      ).length;
    }
  }
  if (jwksKeyCount === 0) {
    return {
      validation: { result: "jwks_invalid", issuerValid: true, jwksValid: false, jwksKeyCount: 0 },
      metadata,
    };
  }

  return {
    validation: { result: "ok", issuerValid: true, jwksValid: true, jwksKeyCount },
    metadata,
  };
}

export type ImportDiscoveryResult =
  | { kind: "invalid_body"; message: string }
  | { kind: "ok"; response: OidcDiscoverResponse };

/** `POST /api/auth/settings/idps/oidc/discover` — no mutation, no audit. */
export async function importOidcDiscovery(
  rawBody: unknown,
  deps: { fetcher: OidcHttpFetcher }
): Promise<ImportDiscoveryResult> {
  const parsed = OidcDiscoverRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return { kind: "invalid_body", message: parsed.error.issues[0]?.message ?? "Invalid body" };
  }
  const discoveryUrl = resolveDiscoveryUrl(parsed.data);
  if (!discoveryUrl) return { kind: "invalid_body", message: "issuer or discoveryUrl is required" };

  const { validation, metadata } = await probeOidcDiscovery(
    { discoveryUrl, expectedIssuer: parsed.data.issuer },
    deps
  );
  return { kind: "ok", response: { metadata, validation } };
}

/** Pure: the brokered callback URL Keycloak exposes for a tenant realm IdP alias. */
export function buildIdpCallbackUrl(
  keycloakUrl: string,
  realmName: string,
  alias: string
): IdpCallbackUrlResponse {
  const base = trimTrailingSlashes(keycloakUrl);
  return {
    alias,
    callbackUrl: `${base}/realms/${encodeURIComponent(realmName)}/broker/${encodeURIComponent(alias)}/endpoint`,
  };
}

// --- test connection -------------------------------------------------------

/** Narrow port: read a single IdP representation (the adapter satisfies it). */
export interface IdpReaderPort {
  getIdentityProvider(alias: string): Promise<IdentityProvider | null>;
}

export interface TestConnectionInput {
  alias: string;
  organisationId: string;
  realmName: string;
  actorId: string;
  actorRoles: string[];
  sourceHost?: string;
  ipAddress?: string;
}

export interface TestConnectionDeps {
  reader: IdpReaderPort;
  fetcher: OidcHttpFetcher;
  audit: AuditEventPort;
}

export type TestConnectionResult =
  | { kind: "not_found" }
  | { kind: "ok"; validation: OidcValidationResult };

/**
 * `POST /api/auth/settings/idps/:alias/test-connection`. Reads the stored issuer,
 * re-validates discovery + JWKS, and records a safe audit event (alias + result;
 * never a secret). A non-interactive probe — NOT a full login simulation.
 */
export async function testIdpConnection(
  input: TestConnectionInput,
  deps: TestConnectionDeps
): Promise<TestConnectionResult> {
  let idp: IdentityProvider | null;
  try {
    idp = await deps.reader.getIdentityProvider(input.alias);
  } catch {
    // The realm could not be read — classify as unreachable rather than 500.
    const validation: OidcValidationResult = {
      result: "unreachable",
      issuerValid: false,
      jwksValid: false,
      jwksKeyCount: 0,
    };
    await emitTestAudit(input, deps.audit, validation.result);
    return { kind: "ok", validation };
  }
  if (!idp) return { kind: "not_found" };

  const issuer = asString(idp.config?.["issuer"]);
  let validation: OidcValidationResult;
  if (!issuer) {
    validation = {
      result: "not_configured",
      issuerValid: false,
      jwksValid: false,
      jwksKeyCount: 0,
    };
  } else {
    const discoveryUrl = resolveDiscoveryUrl({ issuer })!;
    validation = (await probeOidcDiscovery({ discoveryUrl, expectedIssuer: issuer }, deps))
      .validation;
  }
  await emitTestAudit(input, deps.audit, validation.result);
  return { kind: "ok", validation };
}

async function emitTestAudit(
  input: TestConnectionInput,
  audit: AuditEventPort,
  result: OidcConnectionResult
): Promise<void> {
  await audit.emit(
    createAuditEvent({
      actorId: input.actorId,
      actorRoles: input.actorRoles,
      tenantId: input.organisationId,
      action: AuditAction.AuthSettingsIdpTested,
      resource: "auth_settings",
      resourceId: input.alias,
      metadata: { operation: "test_connection", alias: input.alias, result },
      sourceHost: input.sourceHost,
      ipAddress: input.ipAddress,
    })
  );
}
