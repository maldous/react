import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  mapKeycloakClaims,
  exchangeCodeForTokens,
  getUserInfo,
  buildAuthorizationUrl,
  verifyKeycloakToken,
  type KeycloakClientConfig,
} from "../src/index.ts";

const CONFIG: KeycloakClientConfig = {
  url: "http://localhost:8080",
  realm: "platform",
  clientId: "platform-api",
  clientSecret: "test-secret",
};

// ---------------------------------------------------------------------------
// Fetch mock helpers
// ---------------------------------------------------------------------------

type FetchMock = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function mockFetch(handler: FetchMock): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = handler as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// ---------------------------------------------------------------------------
// mapKeycloakClaims
// ---------------------------------------------------------------------------

describe("mapKeycloakClaims", () => {
  it("maps sub, preferred_username, email, and realm_access.roles", () => {
    const result = mapKeycloakClaims({
      sub: "kc-user-1",
      preferred_username: "admin@fixture.local",
      email: "admin@fixture.local",
      realm_access: { roles: ["tenant-admin"] },
    });
    assert.equal(result.providerSubject, "kc-user-1");
    assert.equal(result.provider, "keycloak");
    assert.equal(result.email, "admin@fixture.local");
    assert.equal(result.displayName, "admin@fixture.local");
    assert.deepEqual(result.realmRoles, ["tenant-admin"]);
  });

  it("falls back to preferred_username when email is absent", () => {
    const result = mapKeycloakClaims({ sub: "s", preferred_username: "u" });
    assert.equal(result.email, "u");
    assert.equal(result.displayName, "u");
  });

  it("returns empty realmRoles when realm_access is absent", () => {
    const result = mapKeycloakClaims({ sub: "s", preferred_username: "u" });
    assert.deepEqual(result.realmRoles, []);
  });
});

// ---------------------------------------------------------------------------
// buildAuthorizationUrl
// ---------------------------------------------------------------------------

describe("buildAuthorizationUrl", () => {
  it("includes all required PKCE parameters", () => {
    const url = buildAuthorizationUrl(
      { state: "abc", codeChallenge: "xyz", redirectUri: "http://localhost:3001/auth/callback" },
      CONFIG
    );
    const parsed = new URL(url);
    assert.equal(parsed.searchParams.get("response_type"), "code");
    assert.equal(parsed.searchParams.get("client_id"), "platform-api");
    assert.equal(parsed.searchParams.get("state"), "abc");
    assert.equal(parsed.searchParams.get("code_challenge"), "xyz");
    assert.equal(parsed.searchParams.get("code_challenge_method"), "S256");
    assert.equal(parsed.searchParams.get("redirect_uri"), "http://localhost:3001/auth/callback");
    assert.ok(parsed.searchParams.get("scope")?.includes("openid"));
  });

  it("points to the correct Keycloak authorize endpoint", () => {
    const url = buildAuthorizationUrl(
      { state: "s", codeChallenge: "c", redirectUri: "http://localhost:3001/auth/callback" },
      CONFIG
    );
    assert.ok(url.startsWith("http://localhost:8080/realms/platform/protocol/openid-connect/auth"));
  });
});

// ---------------------------------------------------------------------------
// exchangeCodeForTokens
// ---------------------------------------------------------------------------

describe("exchangeCodeForTokens", () => {
  let restore: () => void;
  beforeEach(() => {
    restore = () => {};
  });
  afterEach(() => restore());

  it("returns tokens on 200 response", async () => {
    restore = mockFetch(async () =>
      jsonResponse({ access_token: "at-123", refresh_token: "rt-456", expires_in: 900 })
    );
    const result = await exchangeCodeForTokens(
      { code: "code1", redirectUri: "http://localhost:3001/auth/callback", codeVerifier: "cv1" },
      CONFIG
    );
    assert.ok(result !== null);
    assert.equal(result.accessToken, "at-123");
    assert.equal(result.refreshToken, "rt-456");
    assert.equal(result.expiresIn, 900);
  });

  it("returns null on 401 response", async () => {
    restore = mockFetch(async () => new Response(null, { status: 401 }));
    const result = await exchangeCodeForTokens(
      { code: "bad", redirectUri: "http://localhost:3001/auth/callback", codeVerifier: "cv" },
      CONFIG
    );
    assert.equal(result, null);
  });

  it("returns null on network error", async () => {
    restore = mockFetch(async () => {
      throw new Error("Network error");
    });
    const result = await exchangeCodeForTokens(
      { code: "c", redirectUri: "http://localhost:3001/auth/callback", codeVerifier: "cv" },
      CONFIG
    );
    assert.equal(result, null);
  });

  it("sends code_verifier in the body for PKCE", async () => {
    let capturedBody = "";
    restore = mockFetch(async (_, init) => {
      capturedBody = (init?.body as string) ?? "";
      return jsonResponse({ access_token: "at", refresh_token: "rt", expires_in: 300 });
    });
    await exchangeCodeForTokens(
      {
        code: "mycode",
        redirectUri: "http://localhost:3001/auth/callback",
        codeVerifier: "myverifier",
      },
      CONFIG
    );
    assert.ok(capturedBody.includes("code_verifier=myverifier"));
    assert.ok(capturedBody.includes("grant_type=authorization_code"));
    assert.ok(!capturedBody.includes("client_secret") || capturedBody.includes("test-secret"));
  });
});

// ---------------------------------------------------------------------------
// getUserInfo
// ---------------------------------------------------------------------------

describe("getUserInfo", () => {
  let restore: () => void;
  beforeEach(() => {
    restore = () => {};
  });
  afterEach(() => restore());

  it("returns mapped identity on success", async () => {
    restore = mockFetch(async () =>
      jsonResponse({
        sub: "kc-sub-1",
        preferred_username: "admin@fixture.local",
        email: "admin@fixture.local",
        realm_access: { roles: ["tenant-admin"] },
      })
    );
    const result = await getUserInfo("valid-token", CONFIG);
    assert.ok(result !== null);
    assert.equal(result.providerSubject, "kc-sub-1");
    assert.equal(result.provider, "keycloak");
    assert.deepEqual(result.realmRoles, ["tenant-admin"]);
  });

  it("sends Authorization Bearer header", async () => {
    let capturedHeader = "";
    restore = mockFetch(async (_, init) => {
      capturedHeader = (init?.headers as Record<string, string>)?.["Authorization"] ?? "";
      return jsonResponse({ sub: "s", preferred_username: "u" });
    });
    await getUserInfo("my-token", CONFIG);
    assert.equal(capturedHeader, "Bearer my-token");
  });

  it("returns null on 401 response", async () => {
    restore = mockFetch(async () => new Response(null, { status: 401 }));
    const result = await getUserInfo("expired-token", CONFIG);
    assert.equal(result, null);
  });

  it("returns null on network error", async () => {
    restore = mockFetch(async () => {
      throw new Error("Network error");
    });
    const result = await getUserInfo("t", CONFIG);
    assert.equal(result, null);
  });
});

// ---------------------------------------------------------------------------
// verifyKeycloakToken (stub)
// ---------------------------------------------------------------------------

describe("verifyKeycloakToken", () => {
  it("returns null (stub — use getUserInfo for identity resolution)", async () => {
    const result = await verifyKeycloakToken("any-token");
    assert.equal(result, null);
  });
});

// ---------------------------------------------------------------------------
// Import-boundary assertion: no Keycloak SDK types in exports
// ---------------------------------------------------------------------------

describe("import boundary: no Keycloak SDK in exports", () => {
  it("module exports only platform-internal types", async () => {
    const mod = await import("../src/index.ts");
    // Should export these identifiers
    assert.ok("mapKeycloakClaims" in mod);
    assert.ok("exchangeCodeForTokens" in mod);
    assert.ok("getUserInfo" in mod);
    assert.ok("buildAuthorizationUrl" in mod);
    assert.ok("packageName" in mod);
    // Should NOT export raw Keycloak SDK types (KeycloakTokenClaims is internal only)
    assert.ok(!("KeycloakTokenClaims" in mod));
  });
});
