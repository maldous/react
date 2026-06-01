import crypto from "node:crypto";
import { ConflictError, ValidationError, toSafeResponse } from "@platform/platform-errors";
import {
  buildAuthorizationUrl,
  exchangeCodeForTokens,
  getUserInfo,
} from "@platform/adapters-keycloak";
import { SESSION_COOKIE_NAME } from "@platform/adapters-redis";
import { resolveSessionFromIdentity, destroySession } from "../usecases/auth.ts";
import { serverT } from "./i18n.ts";
import {
  getKeycloakConfig,
  getKeycloakConfigForRealm,
  getAuthCallbackUrl,
  getKeycloakPublicUrl,
  getAppBaseUrl,
  getAuthStateStore,
  getSessionStore,
  getIdentityRepository,
  getApplicationPool,
  schemeFor,
  isAllowedHost,
} from "./dependencies.ts";
import { resolveTenantFromRequest } from "./tenant-resolver.ts";
import type { PipelineHandler } from "./pipeline.ts";

// ---------------------------------------------------------------------------
// PKCE helpers
// ---------------------------------------------------------------------------

function generateCodeVerifier(): string {
  return crypto.randomBytes(32).toString("base64url");
}

async function generateCodeChallenge(verifier: string): Promise<string> {
  const hash = crypto.createHash("sha256").update(verifier).digest();
  return hash.toString("base64url");
}

// ---------------------------------------------------------------------------
// Session cookie helpers
// ---------------------------------------------------------------------------

function getSessionCookieDomain(): string | undefined {
  return process.env["SESSION_COOKIE_DOMAIN"];
}

// Exported for unit testing only.
// Local HTTP (Compose/dev): SESSION_COOKIE_SECURE=false (default in compose.yaml)
// Cloudflare/HTTPS production: SESSION_COOKIE_SECURE=true (set in .env.staging / .env.prod)
// NODE_ENV=production does NOT imply Secure — Cloudflare Flexible SSL means the
// browser→Caddy leg is plain HTTP; browsers reject Secure cookies over HTTP.
export function isSecureCookie(): boolean {
  return process.env["SESSION_COOKIE_SECURE"] === "true";
}

function buildSetCookieHeader(sessionId: string): string {
  const parts = [`${SESSION_COOKIE_NAME}=${sessionId}`, "HttpOnly", "SameSite=Strict", "Path=/"];
  if (isSecureCookie()) parts.push("Secure");
  const domain = getSessionCookieDomain();
  if (domain) parts.push(`Domain=${domain}`);
  const ttl = parseInt(process.env["SESSION_TTL_SECONDS"] ?? "1800", 10);
  parts.push(`Max-Age=${ttl}`);
  return parts.join("; ");
}

function buildClearCookieHeader(): string {
  const parts = [`${SESSION_COOKIE_NAME}=`, "HttpOnly", "SameSite=Strict", "Path=/", "Max-Age=0"];
  if (isSecureCookie()) parts.push("Secure");
  return parts.join("; ");
}

const PRE_AUTH_COOKIE = "auth_state_token";

/**
 * Pre-auth nonce cookie bound to the initiating user-agent.
 * SameSite=Lax (not Strict) so it is included on the top-level
 * GET redirect back from Keycloak.
 */
function buildPreAuthCookieHeader(nonce: string): string {
  const parts = [
    `${PRE_AUTH_COOKIE}=${nonce}`,
    "HttpOnly",
    "SameSite=Lax",
    "Path=/auth",
    "Max-Age=300",
  ];
  if (isSecureCookie()) parts.push("Secure");
  return parts.join("; ");
}

function buildClearPreAuthCookieHeader(): string {
  const parts = [`${PRE_AUTH_COOKIE}=`, "HttpOnly", "SameSite=Lax", "Path=/auth", "Max-Age=0"];
  if (isSecureCookie()) parts.push("Secure");
  return parts.join("; ");
}

function parseSessionCookie(rawCookieHeader: string | undefined): string | null {
  if (!rawCookieHeader) return null;
  for (const part of rawCookieHeader.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name?.trim() === SESSION_COOKIE_NAME) return rest.join("=").trim();
  }
  return null;
}

function parsePreAuthCookie(rawCookieHeader: string | undefined): string | null {
  if (!rawCookieHeader) return null;
  for (const part of rawCookieHeader.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name?.trim() === PRE_AUTH_COOKIE) return rest.join("=").trim();
  }
  return null;
}

// ---------------------------------------------------------------------------
// GET /auth/login
//
// Generates PKCE state+verifier, stores in Redis auth-state store,
// then redirects to the Keycloak authorization endpoint.
// ---------------------------------------------------------------------------

export const handleAuthLogin: PipelineHandler = async (req, res) => {
  const url = new URL(req.raw.url ?? "/", "http://localhost");
  const rawReturnTo = url.searchParams.get("returnTo") ?? "/";

  // Sanitise returnTo: only relative paths are allowed (open-redirect protection)
  const returnTo = rawReturnTo.startsWith("/") ? rawReturnTo : "/";

  // Derive the request host for dynamic callback URL and Keycloak public URL.
  // X-Forwarded-Host / X-Forwarded-Proto are set by Caddy and Cloudflare.
  const host =
    (req.raw.headers["x-forwarded-host"] as string | undefined) ?? req.raw.headers["host"];
  const forwardedProto = req.raw.headers["x-forwarded-proto"] as string | undefined;

  // Resolve the Keycloak realm for this tenant's FQDN (ADR-0029 ?2b).
  // Falls back to the global platform realm when on aldous.info root or dev mode.
  const tenantCtx = await resolveTenantFromRequest(req.raw, getApplicationPool()).catch(() => null);
  const keycloakCfg = {
    ...(tenantCtx ? getKeycloakConfigForRealm(tenantCtx.realmName) : getKeycloakConfig()),
    // Override publicUrl with host-derived URL so every tenant gets the correct
    // Keycloak origin in the authorization redirect (ADR-0029, ADR-0032).
    publicUrl: getKeycloakPublicUrl(host, forwardedProto),
  };

  const state = crypto.randomUUID();
  const nonce = crypto.randomUUID(); // bound to this user-agent via pre-auth cookie
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await generateCodeChallenge(codeVerifier);

  await getAuthStateStore().put(state, { codeVerifier, returnTo, nonce });

  const authUrl = buildAuthorizationUrl(
    { state, codeChallenge, redirectUri: getAuthCallbackUrl(host, forwardedProto) },
    keycloakCfg
  );

  // Set a short-lived HttpOnly pre-auth cookie so /auth/callback can verify
  // the request came from the same user-agent that initiated the flow.
  res.raw.writeHead(302, {
    Location: authUrl,
    "Set-Cookie": buildPreAuthCookieHeader(nonce),
  });
  res.raw.end();
};

// ---------------------------------------------------------------------------
// GET /auth/callback
//
// Validates state, exchanges code for tokens, resolves identity + session,
// sets HTTP-only session cookie, redirects to the React app.
// ---------------------------------------------------------------------------

export const handleAuthCallback: PipelineHandler = async (req, res) => {
  const url = new URL(req.raw.url ?? "/", "http://localhost");
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const errorParam = url.searchParams.get("error");

  // Derive host/proto for dynamic callback URL (must match authorization request exactly)
  const callbackHost =
    (req.raw.headers["x-forwarded-host"] as string | undefined) ??
    req.raw.headers["host"] ??
    "localhost";
  const callbackProto = req.raw.headers["x-forwarded-proto"] as string | undefined;

  // Resolve the tenant realm from the FQDN for token exchange (ADR-0029 ?2b)
  const callbackTenantCtx = await resolveTenantFromRequest(req.raw, getApplicationPool()).catch(
    () => null
  );
  const callbackKeycloakCfg = callbackTenantCtx
    ? getKeycloakConfigForRealm(callbackTenantCtx.realmName)
    : getKeycloakConfig();

  if (errorParam) {
    res.json(
      400,
      toSafeResponse(new ValidationError("api.error.keycloakError"), (msg) =>
        serverT(msg, { error: errorParam })
      )
    );
    return;
  }

  if (!code || !state) {
    res.json(
      400,
      toSafeResponse(new ValidationError("api.error.missingCodeOrState"), (msg) => serverT(msg))
    );
    return;
  }

  // Verify pre-auth nonce cookie (user-agent binding)
  const preAuthNonce = parsePreAuthCookie(req.raw.headers["cookie"]);
  if (!preAuthNonce) {
    res.json(
      400,
      toSafeResponse(new ValidationError("api.error.missingPreAuthCookie"), (msg) => serverT(msg))
    );
    return;
  }

  // Consume auth state (one-time use ? prevents replay)
  const authState = await getAuthStateStore().take(state);
  if (!authState) {
    res.json(
      400,
      toSafeResponse(new ValidationError("api.error.invalidOrExpiredState"), (msg) => serverT(msg))
    );
    return;
  }

  // Verify the pre-auth nonce matches the one bound at login time
  if (preAuthNonce !== authState.nonce) {
    res.json(
      400,
      toSafeResponse(new ValidationError("api.error.authFlowBindingMismatch"), (msg) =>
        serverT(msg)
      )
    );
    return;
  }

  // Exchange authorization code for tokens (using tenant-aware realm config).
  // redirectUri must exactly match what was used in the authorization request.
  const tokens = await exchangeCodeForTokens(
    {
      code,
      redirectUri: getAuthCallbackUrl(callbackHost, callbackProto),
      codeVerifier: authState.codeVerifier,
    },
    callbackKeycloakCfg
  );
  if (!tokens) {
    res.json(
      502,
      toSafeResponse(new ValidationError("api.error.tokenExchangeFailed"), (msg) => serverT(msg))
    );
    return;
  }

  // Get user identity from Keycloak /userinfo (using tenant-aware realm config)
  const identity = await getUserInfo(tokens.accessToken, callbackKeycloakCfg);
  if (!identity) {
    res.json(
      401,
      toSafeResponse(new ValidationError("api.error.unverifiedOrMissingEmail"), (msg) =>
        serverT(msg)
      )
    );
    return;
  }

  // Resolve or create platform session
  const ttlSeconds = parseInt(process.env["SESSION_TTL_SECONDS"] ?? "1800", 10);
  let session;
  try {
    session = await resolveSessionFromIdentity(
      identity,
      {
        identities: getIdentityRepository(),
        sessions: getSessionStore(),
      },
      ttlSeconds,
      // Pass tokens for encrypted storage (ADR-ACT-0153)
      {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresIn: tokens.expiresIn,
      }
    );
  } catch (err) {
    if (err instanceof ConflictError) {
      // Email already registered under a different identity ? 409 Conflict.
      // The raw ConflictError from the identity adapter reaches here because the
      // pipeline's unhandled-error branch always emits 500; catching it here
      // gives the user-agent the semantically correct HTTP status.
      res.json(409, toSafeResponse(err));
      return;
    }
    throw err;
  }

  // Set session cookie, clear pre-auth cookie, redirect to React app.
  // Use the request host to derive the redirect base URL ? this makes
  // multi-tenant and .localhost domains work without per-domain APP_BASE_URL config.
  // Falls back to APP_BASE_URL env var when host is not available or allowed.
  const redirectProto = callbackProto ?? schemeFor(callbackHost);
  const redirectBase = isAllowedHost(callbackHost)
    ? `${redirectProto}://${callbackHost}`
    : getAppBaseUrl();
  res.raw.writeHead(302, {
    "Set-Cookie": [buildSetCookieHeader(session.sessionId), buildClearPreAuthCookieHeader()],
    Location: `${redirectBase}${authState.returnTo}`,
  });
  res.raw.end();
};

// ---------------------------------------------------------------------------
// POST /auth/logout
//
// Destroys the server-side session and clears the cookie.
// Keycloak global logout is deferred (ADR-ACT-0119 follow-up).
// ---------------------------------------------------------------------------

export const handleAuthLogout: PipelineHandler = async (req, res) => {
  const sessionId = parseSessionCookie(req.raw.headers["cookie"]);
  if (sessionId) {
    await destroySession(sessionId, { sessions: getSessionStore() });
  }
  res.raw.writeHead(204, { "Set-Cookie": buildClearCookieHeader() });
  res.raw.end();
};

// ---------------------------------------------------------------------------
// Exported cookie parser for pipeline use
// ---------------------------------------------------------------------------

export { parseSessionCookie };
