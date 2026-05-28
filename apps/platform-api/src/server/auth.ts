import crypto from "node:crypto";
import { ConflictError, ValidationError, toSafeResponse } from "@platform/platform-errors";
import {
  buildAuthorizationUrl,
  exchangeCodeForTokens,
  getUserInfo,
} from "@platform/adapters-keycloak";
import { SESSION_COOKIE_NAME } from "@platform/adapters-redis";
import { resolveSessionFromIdentity, destroySession } from "../usecases/auth.ts";
import {
  getKeycloakConfig,
  getAuthCallbackUrl,
  getAppBaseUrl,
  getAuthStateStore,
  getSessionStore,
  getIdentityRepository,
} from "./dependencies.ts";
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

function isSecureCookie(): boolean {
  return (
    process.env["NODE_ENV"] === "production" || process.env["SESSION_COOKIE_SECURE"] === "true"
  );
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

  const state = crypto.randomUUID();
  const nonce = crypto.randomUUID(); // bound to this user-agent via pre-auth cookie
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await generateCodeChallenge(codeVerifier);

  await getAuthStateStore().put(state, { codeVerifier, returnTo, nonce });

  const authUrl = buildAuthorizationUrl(
    { state, codeChallenge, redirectUri: getAuthCallbackUrl() },
    getKeycloakConfig()
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

  if (errorParam) {
    res.json(400, toSafeResponse(new ValidationError(`Keycloak error: ${errorParam}`)));
    return;
  }

  if (!code || !state) {
    res.json(400, toSafeResponse(new ValidationError("Missing code or state parameter")));
    return;
  }

  // Verify pre-auth nonce cookie (user-agent binding)
  const preAuthNonce = parsePreAuthCookie(req.raw.headers["cookie"]);
  if (!preAuthNonce) {
    res.json(400, toSafeResponse(new ValidationError("Missing pre-auth cookie")));
    return;
  }

  // Consume auth state (one-time use — prevents replay)
  const authState = await getAuthStateStore().take(state);
  if (!authState) {
    res.json(400, toSafeResponse(new ValidationError("Invalid or expired state parameter")));
    return;
  }

  // Verify the pre-auth nonce matches the one bound at login time
  if (preAuthNonce !== authState.nonce) {
    res.json(400, toSafeResponse(new ValidationError("Auth flow binding mismatch")));
    return;
  }

  // Exchange authorization code for tokens
  const tokens = await exchangeCodeForTokens(
    { code, redirectUri: getAuthCallbackUrl(), codeVerifier: authState.codeVerifier },
    getKeycloakConfig()
  );
  if (!tokens) {
    res.json(502, toSafeResponse(new ValidationError("Token exchange failed")));
    return;
  }

  // Get user identity from Keycloak /userinfo
  const identity = await getUserInfo(tokens.accessToken, getKeycloakConfig());
  if (!identity) {
    // null means email absent or email_verified !== true (Fix 3)
    res.json(
      401,
      toSafeResponse(new ValidationError("Unverified or missing email — login refused"))
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
      ttlSeconds
    );
  } catch (err) {
    if (err instanceof ConflictError) {
      // Email already registered under a different identity — 409 Conflict.
      // The raw ConflictError from the identity adapter reaches here because the
      // pipeline's unhandled-error branch always emits 500; catching it here
      // gives the user-agent the semantically correct HTTP status.
      res.json(409, toSafeResponse(err));
      return;
    }
    throw err;
  }

  // Set session cookie, clear pre-auth cookie, redirect to React app
  res.raw.writeHead(302, {
    "Set-Cookie": [buildSetCookieHeader(session.sessionId), buildClearPreAuthCookieHeader()],
    Location: `${getAppBaseUrl()}${authState.returnTo}`,
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
