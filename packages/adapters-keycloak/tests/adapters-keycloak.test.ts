import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  mapKeycloakClaims,
  exchangeCodeForTokens,
  getUserInfo,
  buildAuthorizationUrl,
  verifyKeycloakToken,
  type KeycloakClientConfig,
  KeycloakRealmAdminAdapter,
  type KeycloakAdminConfig,
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
  it("maps verified email, preferred_username, and realm_access.roles", () => {
    const result = mapKeycloakClaims({
      sub: "kc-user-1",
      preferred_username: "admin@fixture.local",
      email: "admin@fixture.local",
      email_verified: true,
      realm_access: { roles: ["tenant-admin"] },
    });
    assert.ok(result !== null, "Should return a result for a verified email");
    assert.equal(result.providerSubject, "kc-user-1");
    assert.equal(result.provider, "keycloak");
    assert.equal(result.email, "admin@fixture.local");
    assert.equal(result.displayName, "admin@fixture.local");
    assert.deepEqual(result.realmRoles, ["tenant-admin"]);
  });

  it("returns null when email is absent ? no preferred_username fallback for email", () => {
    // preferred_username is user-controlled and unverified; it must never become the email
    const result = mapKeycloakClaims({ sub: "s", preferred_username: "u", email_verified: true });
    assert.equal(result, null, "Should return null when email claim is absent");
  });

  it("returns null when email_verified is false", () => {
    const result = mapKeycloakClaims({
      sub: "s",
      email: "user@example.com",
      email_verified: false,
    });
    assert.equal(result, null, "Should return null for unverified email");
  });

  it("returns null when email_verified is absent", () => {
    const result = mapKeycloakClaims({ sub: "s", email: "user@example.com" });
    assert.equal(result, null, "Should return null when email_verified is missing");
  });

  it("uses preferred_username for displayName (not email)", () => {
    const result = mapKeycloakClaims({
      sub: "s",
      email: "actual@example.com",
      email_verified: true,
      preferred_username: "display-handle",
    });
    assert.ok(result !== null);
    assert.equal(result.email, "actual@example.com");
    assert.equal(result.displayName, "display-handle");
  });

  it("returns empty realmRoles when realm_access is absent", () => {
    const result = mapKeycloakClaims({
      sub: "s",
      email: "u@example.com",
      email_verified: true,
    });
    assert.ok(result !== null);
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

  it("returns mapped identity on success (verified email)", async () => {
    restore = mockFetch(async () =>
      jsonResponse({
        sub: "kc-sub-1",
        preferred_username: "admin@fixture.local",
        email: "admin@fixture.local",
        email_verified: true,
        realm_access: { roles: ["tenant-admin"] },
      })
    );
    const result = await getUserInfo("valid-token", CONFIG);
    assert.ok(result !== null);
    assert.equal(result.providerSubject, "kc-sub-1");
    assert.equal(result.provider, "keycloak");
    assert.deepEqual(result.realmRoles, ["tenant-admin"]);
  });

  it("returns null when userinfo has unverified email", async () => {
    restore = mockFetch(async () =>
      jsonResponse({ sub: "s", email: "u@example.com", email_verified: false })
    );
    const result = await getUserInfo("valid-token", CONFIG);
    assert.equal(result, null);
  });

  it("sends Authorization Bearer header", async () => {
    let capturedHeader = "";
    restore = mockFetch(async (_, init) => {
      capturedHeader = (init?.headers as Record<string, string>)?.["Authorization"] ?? "";
      return jsonResponse({ sub: "s", email: "u@example.com", email_verified: true });
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
  it("returns null (stub ? use getUserInfo for identity resolution)", async () => {
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

// ---------------------------------------------------------------------------
// KeycloakRealmAdminAdapter — group methods (ADR-ACT-0143 Slice 2)
// ---------------------------------------------------------------------------

const ADMIN_CONFIG: KeycloakAdminConfig = {
  url: "http://localhost:8080",
  realm: "tenant-abc",
  adminClientId: "tenant-service-account",
  adminClientSecret: "secret",
};

const TOKEN_RESPONSE = { access_token: "test-admin-token" };

// Helper: multi-step fetch mock (token then group endpoint)
function twoStepFetch(groupResponse: FetchMock): FetchMock {
  let callCount = 0;
  return async (input, init) => {
    callCount++;
    if (callCount === 1) return jsonResponse(TOKEN_RESPONSE);
    return groupResponse(input, init);
  };
}

describe("KeycloakRealmAdminAdapter — listGroups", () => {
  let restore: () => void;
  afterEach(() => restore?.());

  it("returns group array on 200", async () => {
    const groups = [
      { id: "g1", name: "Editors", path: "/Editors" },
      { id: "g2", name: "Readers", path: "/Readers" },
    ];
    restore = mockFetch(twoStepFetch(async () => jsonResponse(groups)));
    const adapter = new KeycloakRealmAdminAdapter(ADMIN_CONFIG);
    const result = await adapter.listGroups();
    assert.equal(result.length, 2);
    assert.equal(result[0]?.name, "Editors");
  });

  it("returns empty array on non-OK response (fail-soft)", async () => {
    restore = mockFetch(twoStepFetch(async () => new Response(null, { status: 503 })));
    const adapter = new KeycloakRealmAdminAdapter(ADMIN_CONFIG);
    const result = await adapter.listGroups();
    assert.deepEqual(result, []);
  });

  it("calls correct URL path", async () => {
    let capturedUrl = "";
    restore = mockFetch(
      twoStepFetch(async (input) => {
        capturedUrl = typeof input === "string" ? input : (input as URL).toString();
        return jsonResponse([]);
      })
    );
    const adapter = new KeycloakRealmAdminAdapter(ADMIN_CONFIG);
    await adapter.listGroups();
    assert.ok(
      capturedUrl.includes("/admin/realms/tenant-abc/groups"),
      `unexpected URL: ${capturedUrl}`
    );
  });
});

describe("KeycloakRealmAdminAdapter — getGroup", () => {
  let restore: () => void;
  afterEach(() => restore?.());

  it("returns group on 200", async () => {
    const group = { id: "g1", name: "Editors", path: "/Editors" };
    restore = mockFetch(twoStepFetch(async () => jsonResponse(group)));
    const adapter = new KeycloakRealmAdminAdapter(ADMIN_CONFIG);
    const result = await adapter.getGroup("g1");
    assert.ok(result !== null);
    assert.equal(result?.name, "Editors");
  });

  it("returns null on 404", async () => {
    restore = mockFetch(twoStepFetch(async () => new Response(null, { status: 404 })));
    const adapter = new KeycloakRealmAdminAdapter(ADMIN_CONFIG);
    const result = await adapter.getGroup("missing");
    assert.equal(result, null);
  });

  it("calls correct URL path with encoded groupId", async () => {
    let capturedUrl = "";
    restore = mockFetch(
      twoStepFetch(async (input) => {
        capturedUrl = typeof input === "string" ? input : (input as URL).toString();
        return jsonResponse({ id: "g1", name: "X", path: "/X" });
      })
    );
    const adapter = new KeycloakRealmAdminAdapter(ADMIN_CONFIG);
    await adapter.getGroup("group-id-123");
    assert.ok(capturedUrl.includes("group-id-123"), `URL must include groupId: ${capturedUrl}`);
  });
});

describe("KeycloakRealmAdminAdapter — createGroup", () => {
  let restore: () => void;
  afterEach(() => restore?.());

  it("returns extracted group ID from Location header", async () => {
    restore = mockFetch(
      twoStepFetch(
        async () =>
          new Response(null, {
            status: 201,
            headers: {
              Location: "http://localhost:8080/admin/realms/tenant-abc/groups/new-group-id",
            },
          })
      )
    );
    const adapter = new KeycloakRealmAdminAdapter(ADMIN_CONFIG);
    const id = await adapter.createGroup("MyNewGroup");
    assert.equal(id, "new-group-id");
  });

  it("sends POST with correct name in body", async () => {
    let capturedBody = "";
    restore = mockFetch(
      twoStepFetch(async (input, init) => {
        capturedBody = init?.body as string;
        return new Response(null, {
          status: 201,
          headers: { Location: "http://x/groups/new-id" },
        });
      })
    );
    const adapter = new KeycloakRealmAdminAdapter(ADMIN_CONFIG);
    await adapter.createGroup("TestGroup");
    const parsed = JSON.parse(capturedBody) as { name: string };
    assert.equal(parsed.name, "TestGroup");
  });

  it("throws on non-201 response", async () => {
    restore = mockFetch(twoStepFetch(async () => new Response(null, { status: 500 })));
    const adapter = new KeycloakRealmAdminAdapter(ADMIN_CONFIG);
    await assert.rejects(() => adapter.createGroup("Bad"), /createGroup: failed 500/);
  });
});

describe("KeycloakRealmAdminAdapter — updateGroup", () => {
  let restore: () => void;
  afterEach(() => restore?.());

  it("sends PUT with merged body (preserves existing attributes)", async () => {
    let capturedBody = "";
    restore = mockFetch(
      twoStepFetch(async (input, init) => {
        capturedBody = init?.body as string;
        return new Response(null, { status: 204 });
      })
    );
    const existing = { id: "g1", name: "OldName", path: "/OldName", realmRoles: ["viewer"] };
    const adapter = new KeycloakRealmAdminAdapter(ADMIN_CONFIG);
    await adapter.updateGroup("g1", "NewName", existing);
    const parsed = JSON.parse(capturedBody) as { name: string; realmRoles: string[] };
    assert.equal(parsed.name, "NewName");
    assert.deepEqual(parsed.realmRoles, ["viewer"], "existing attributes must be preserved");
  });

  it("throws on non-OK response", async () => {
    restore = mockFetch(twoStepFetch(async () => new Response(null, { status: 403 })));
    const existing = { id: "g1", name: "Old", path: "/Old" };
    const adapter = new KeycloakRealmAdminAdapter(ADMIN_CONFIG);
    await assert.rejects(
      () => adapter.updateGroup("g1", "New", existing),
      /updateGroup: failed 403/
    );
  });
});

describe("KeycloakRealmAdminAdapter — deleteGroup", () => {
  let restore: () => void;
  afterEach(() => restore?.());

  it("sends DELETE to correct path", async () => {
    let capturedMethod = "";
    let capturedUrl = "";
    restore = mockFetch(
      twoStepFetch(async (input, init) => {
        capturedMethod = init?.method ?? "";
        capturedUrl = typeof input === "string" ? input : (input as URL).toString();
        return new Response(null, { status: 204 });
      })
    );
    const adapter = new KeycloakRealmAdminAdapter(ADMIN_CONFIG);
    await adapter.deleteGroup("group-to-delete");
    assert.equal(capturedMethod, "DELETE");
    assert.ok(capturedUrl.includes("group-to-delete"), `URL must include groupId: ${capturedUrl}`);
  });

  it("throws on non-OK response", async () => {
    restore = mockFetch(twoStepFetch(async () => new Response(null, { status: 404 })));
    const adapter = new KeycloakRealmAdminAdapter(ADMIN_CONFIG);
    await assert.rejects(() => adapter.deleteGroup("gone"), /deleteGroup: failed 404/);
  });
});
