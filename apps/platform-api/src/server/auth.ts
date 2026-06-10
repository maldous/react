import crypto from "node:crypto";
import { ConflictError, ValidationError, toSafeResponse } from "@platform/platform-errors";
import {
  buildAuthorizationUrl,
  exchangeCodeForTokens,
  getUserInfo,
} from "@platform/adapters-keycloak";
import { SESSION_COOKIE_NAME } from "@platform/adapters-redis";
import { resolveSessionFromIdentity, destroySession } from "../usecases/auth.ts";
import { decryptToken } from "./token-crypto.ts";
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
import { resolveProviderHint } from "./auth-providers.ts";
import type { PipelineHandler } from "./pipeline.ts";

function safeRelativeRedirect(raw: string): string {
  if (!raw.startsWith("/") || raw.startsWith("//")) return "/login";
  return raw;
}

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
  // SameSite=Lax (not Strict): the session cookie must be included in the top-level
  // GET redirect that follows the Keycloak OAuth callback. With SameSite=Strict the
  // cookie is not sent during the cross-site redirect chain (KC → callback → /),
  // so the React app never sees an authenticated session. Lax is appropriate here
  // because the cookie is HttpOnly and the login flow is a deliberate top-level nav.
  const parts = [`${SESSION_COOKIE_NAME}=${sessionId}`, "HttpOnly", "SameSite=Lax", "Path=/"];
  if (isSecureCookie()) parts.push("Secure");
  const domain = getSessionCookieDomain();
  if (domain) parts.push(`Domain=${domain}`);
  const ttl = parseInt(process.env["SESSION_TTL_SECONDS"] ?? "1800", 10);
  parts.push(`Max-Age=${ttl}`);
  return parts.join("; ");
}

// Returns an array of Set-Cookie headers that clear the session cookie.
// Two headers are emitted so that both:
//   1. the Domain-scoped cookie (set by the current config, e.g. Domain=aldous.info), AND
//   2. any host-only cookie (set by older configs that had no SESSION_COOKIE_DOMAIN)
// are cleared from the browser. This covers users who had a session cookie set
// before SESSION_COOKIE_DOMAIN was introduced.
function buildClearCookieHeaders(): string[] {
  const base = [`${SESSION_COOKIE_NAME}=`, "HttpOnly", "SameSite=Strict", "Path=/", "Max-Age=0"];
  if (isSecureCookie()) base.push("Secure");
  const hostOnly = [...base].join("; ");
  const domain = getSessionCookieDomain();
  if (!domain) return [hostOnly];
  // Domain-scoped clear (matches cookies set with Domain=${domain})
  const domainScoped = [...base, `Domain=${domain}`].join("; ");
  return [hostOnly, domainScoped];
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

  // Resolve the requested product provider (google/azure/apple/platform) to a
  // validated Keycloak kc_idp_hint. Unknown/disabled providers are rejected here
  // so arbitrary kc_idp_hint values can never be injected via the query string.
  const providerResult = resolveProviderHint(url.searchParams.get("provider"));
  if (!providerResult.ok) {
    res.json(
      400,
      toSafeResponse(new ValidationError("api.error.invalidProvider"), (msg) => serverT(msg))
    );
    return;
  }

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
    {
      state,
      codeChallenge,
      redirectUri: getAuthCallbackUrl(host, forwardedProto),
      // null for the platform account (normal Keycloak login); a validated broker
      // alias (e.g. mock-google) for third-party providers.
      ...(providerResult.idpHint ? { idpHint: providerResult.idpHint } : {}),
      // Force a fresh authentication so a user can sign in as a DIFFERENT account
      // after logout (rather than being silently re-authenticated by a lingering
      // Keycloak/upstream SSO session). Keycloak forwards prompt=login to the mock
      // upstream via its forwarded-parameters config. ADR-ACT-0157.
      prompt: "login",
    },
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

  // The app must never see a raw Keycloak/BFF JSON error from the callback. Any
  // non-success way of landing here returns the user to the app's /login with ONE generic
  // error so Keycloak stays invisible (ADR-ACT-0157). callbackHost/Proto are set above.
  const callbackAppProto = callbackProto ?? schemeFor(callbackHost);
  const callbackAppBase = isAllowedHost(callbackHost)
    ? `${callbackAppProto}://${callbackHost}`
    : getAppBaseUrl();
  const bounceToLogin = (): void => {
    res.raw.writeHead(302, {
      "Set-Cookie": buildClearPreAuthCookieHeader(),
      Location: `${callbackAppBase}/login?authError=signin_failed`,
      "Cache-Control": "no-store",
    });
    res.raw.end();
  };

  // Keycloak bounced back with an ?error=, or without a usable code/state (e.g. a flow
  // restart after a brokered failure while the user was already authenticated).
  if (errorParam || !code || !state) {
    bounceToLogin();
    return;
  }

  // Verify pre-auth nonce cookie (user-agent binding). Failures here are security checks
  // (CSRF/replay); returning to /login restarts the flow without granting a session.
  const preAuthNonce = parsePreAuthCookie(req.raw.headers["cookie"]);
  if (!preAuthNonce) {
    bounceToLogin();
    return;
  }

  // Consume auth state (one-time use ? prevents replay)
  const authState = await getAuthStateStore().take(state);
  if (!authState) {
    bounceToLogin();
    return;
  }

  // Verify the pre-auth nonce matches the one bound at login time
  if (preAuthNonce !== authState.nonce) {
    bounceToLogin();
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
    bounceToLogin();
    return;
  }

  // A brokered login that the BFF refuses AFTER Keycloak authenticated the user (KC has
  // already issued the code, i.e. created an SSO session) must tear down that KC session.
  // Otherwise the browser stays logged into Keycloak as the rejected user and the next
  // login as a DIFFERENT user fails with KC "different_user_authenticated" — i.e. "I can't
  // log in as anyone". We have the brokered id_token here, so use it as id_token_hint for
  // a clean RP-logout, clear our cookies, and return the browser to /login?authError=…
  // (no bare JSON error page). ADR-ACT-0157.
  const cbKcPublicBase = getKeycloakPublicUrl(callbackHost, callbackAppProto);
  const clearKcAndReturnToLogin = (authError: string): void => {
    const params = new URLSearchParams({
      client_id: callbackKeycloakCfg.clientId,
      post_logout_redirect_uri: `${callbackAppBase}/login?authError=${authError}`,
    });
    if (tokens.idToken) params.set("id_token_hint", tokens.idToken);
    res.raw.writeHead(302, {
      "Set-Cookie": [...buildClearCookieHeaders(), buildClearPreAuthCookieHeader()],
      Location: `${cbKcPublicBase}/realms/${callbackKeycloakCfg.realm}/protocol/openid-connect/logout?${params.toString()}`,
      "Cache-Control": "no-store",
    });
    res.raw.end();
  };

  // Get user identity from Keycloak /userinfo (using tenant-aware realm config)
  const identity = await getUserInfo(tokens.accessToken, callbackKeycloakCfg);
  if (!identity) {
    // Rejected (unverified upstream email or missing email). Clear the KC session.
    clearKcAndReturnToLogin("email_unverified");
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
      // Pass tokens for encrypted storage (ADR-ACT-0153). idToken is kept for the
      // logout id_token_hint (ADR-ACT-0157).
      {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresIn: tokens.expiresIn,
        idToken: tokens.idToken,
      }
    );
  } catch (err) {
    if (err instanceof ConflictError) {
      // Email already registered under a different identity. Same dangling-KC-session
      // hazard as the unverified case (KC authenticated the user before the BFF refused),
      // so clear the KC session and return to /login with an error rather than stranding
      // the browser on a 409 JSON page. ADR-ACT-0157.
      clearKcAndReturnToLogin("account_conflict");
      return;
    }
    throw err;
  }

  // Set session cookie, clear pre-auth cookie, redirect to React app.
  // callbackAppBase (derived above from the request host) makes multi-tenant and
  // .localhost domains work without per-domain APP_BASE_URL config.
  res.raw.writeHead(302, {
    "Set-Cookie": [buildSetCookieHeader(session.sessionId), buildClearPreAuthCookieHeader()],
    Location: `${callbackAppBase}${authState.returnTo}`,
  });
  res.raw.end();
};

// ---------------------------------------------------------------------------
// GET /auth/logout?returnTo=/login
//
// Browser-navigation logout. Preferred over the POST endpoint for UI flows:
//   1. Destroys the platform Redis session.
//   2. Clears the platform_session cookie (host-only + domain-scoped headers).
//   3. Redirects the browser to the Keycloak RP-Initiated Logout endpoint,
//      which terminates the SSO session for the realm.
//   4. Keycloak then redirects to post_logout_redirect_uri (the returnTo URL).
//
// NOTE: KC 18+ may show a logout confirmation page unless the client is
// configured with skip_logout_confirmation or id_token_hint is provided.
// The platform realm should set this in the KC admin (Realm > Clients > BFF >
// Advanced > "Skip Logout Confirmation"). Alternatively, store id_token at
// callback time and pass it here — tracked as a future hardening item.
//
// For fixture sessions (LOCAL_FIXTURE_SESSION set), Keycloak is not running;
// in that case we redirect directly to the returnTo URL.
// ---------------------------------------------------------------------------

export const handleAuthLogoutRedirect: PipelineHandler = async (req, res) => {
  const sessionId = parseSessionCookie(req.raw.headers["cookie"]);

  // Determine the realm and capture the id_token (for id_token_hint) BEFORE
  // destroying the session.
  let realmName: string = getKeycloakConfig().realm; // platform realm default (sysadmin)
  let idTokenHint = "";
  if (sessionId) {
    try {
      const tenantCtx = await resolveTenantFromRequest(req.raw, getApplicationPool());
      if (tenantCtx?.realmName) realmName = tenantCtx.realmName;
    } catch {
      // Ignore resolution failures — fall back to platform realm
    }
    // Read the stored id_token so the RP-initiated logout can pass id_token_hint —
    // without it Keycloak shows a "Do you want to log out?" confirmation page and
    // leaves the SSO session alive (so re-login is silent). ADR-ACT-0157.
    try {
      const record = await getSessionStore().find(sessionId);
      if (record?.idTokenEnc) idTokenHint = decryptToken(record.idTokenEnc);
    } catch {
      // Best-effort: fall back to logout without the hint (confirmation page).
    }
    await destroySession(sessionId, { sessions: getSessionStore() }).catch(() => undefined);
  }

  const url = new URL(req.raw.url ?? "/", "http://localhost");
  const returnTo = url.searchParams.get("returnTo") ?? "/login";

  const clearHeaders = buildClearCookieHeaders();

  // In fixture / dev mode (no real Keycloak), redirect directly to returnTo
  if (process.env["LOCAL_FIXTURE_SESSION"]) {
    // Reconstruct returnTo as full URL using the request host
    const host =
      (req.raw.headers["x-forwarded-host"] as string | undefined) ??
      req.raw.headers["host"] ??
      "localhost";
    const scheme = (req.raw.headers["x-forwarded-proto"] as string | undefined) ?? "http";
    const redirectTarget = `${scheme}://${host}${safeRelativeRedirect(returnTo)}`;
    res.raw.writeHead(302, {
      "Set-Cookie": clearHeaders,
      Location: redirectTarget,
      "Cache-Control": "no-store",
    });
    res.raw.end();
    return;
  }

  // Construct Keycloak RP-Initiated Logout URL
  const host =
    (req.raw.headers["x-forwarded-host"] as string | undefined) ??
    req.raw.headers["host"] ??
    "localhost";
  const scheme = (req.raw.headers["x-forwarded-proto"] as string | undefined) ?? "http";
  const postLogoutRedirectUri = `${scheme}://${host}${safeRelativeRedirect(returnTo)}`;

  const kcCfg = getKeycloakConfig();
  // Pass host+scheme so getKeycloakPublicUrl returns the host-derived URL
  // (e.g. https://aldous.info/kc) rather than falling back to KEYCLOAK_PUBLIC_URL
  // which may be set to https://aldous.info (without /kc) in some environments.
  const kcPublicBase = getKeycloakPublicUrl(host, scheme);
  const endSessionParams = new URLSearchParams({
    client_id: kcCfg.clientId,
    post_logout_redirect_uri: postLogoutRedirectUri,
  });
  // id_token_hint makes Keycloak skip the logout-confirmation prompt and end the
  // SSO session, then redirect straight to post_logout_redirect_uri (ADR-ACT-0157).
  if (idTokenHint) endSessionParams.set("id_token_hint", idTokenHint);
  const endSessionUrl = `${kcPublicBase}/realms/${realmName}/protocol/openid-connect/logout?${endSessionParams.toString()}`;

  res.raw.writeHead(302, {
    "Set-Cookie": clearHeaders,
    Location: endSessionUrl,
    "Cache-Control": "no-store",
  });
  res.raw.end();
};

// ---------------------------------------------------------------------------
// POST /auth/logout
//
// API / fetch-based logout. Destroys the session and clears cookies.
// Does NOT redirect to Keycloak end_session (cannot do browser-navigation
// from a fetch response). Use GET /auth/logout?returnTo=... for UI flows
// that need full SSO logout.
// ---------------------------------------------------------------------------

export const handleAuthLogout: PipelineHandler = async (req, res) => {
  const sessionId = parseSessionCookie(req.raw.headers["cookie"]);
  if (sessionId) {
    await destroySession(sessionId, { sessions: getSessionStore() }).catch(() => undefined);
  }
  res.raw.writeHead(204, { "Set-Cookie": buildClearCookieHeaders() });
  res.raw.end();
};

// ---------------------------------------------------------------------------
// Exported cookie parser for pipeline use
// ---------------------------------------------------------------------------

export { parseSessionCookie, buildClearCookieHeaders };
