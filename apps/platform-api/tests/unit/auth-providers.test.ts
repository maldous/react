import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { buildAuthorizationUrl } from "@platform/adapters-keycloak";
import {
  getProviderMode,
  mockAllowedHere,
  resolveProviderHint,
  listEnabledProviders,
  brokerAliasFor,
  buildMockIdpDefinitions,
  validateProviderModeAtStartup,
} from "../../src/server/auth-providers.ts";

// These functions read process.env; snapshot + restore around each test so the
// serial test runner (--test-concurrency=1) stays deterministic.
const ENV_KEYS = [
  "AUTH_PROVIDER_MODE",
  "ALLOW_MOCK_IDP_IN_PROD_UNTIL_REAL_PROVIDERS",
  "PLATFORM_ENV",
  "NODE_ENV",
  "MOCK_OIDC_PUBLIC_URL",
  "MOCK_OIDC_INTERNAL_URL",
  "MOCK_OIDC_CLIENT_SECRET",
  "REAL_GOOGLE_ISSUER",
  "REAL_GOOGLE_CLIENT_ID",
  "REAL_GOOGLE_CLIENT_SECRET",
];

let saved: Record<string, string | undefined>;
beforeEach(() => {
  saved = {};
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  // Default test bench: a dev-like, non-prod environment.
  process.env["PLATFORM_ENV"] = "development";
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("provider mode", () => {
  test("defaults to mock in dev/test and real in staging/prod", () => {
    process.env["PLATFORM_ENV"] = "development";
    assert.equal(getProviderMode(), "mock");
    process.env["PLATFORM_ENV"] = "test";
    assert.equal(getProviderMode(), "mock");
    process.env["PLATFORM_ENV"] = "production";
    assert.equal(getProviderMode(), "real");
    process.env["PLATFORM_ENV"] = "staging";
    assert.equal(getProviderMode(), "real");
  });

  test("explicit AUTH_PROVIDER_MODE overrides the default", () => {
    process.env["PLATFORM_ENV"] = "development";
    process.env["AUTH_PROVIDER_MODE"] = "disabled";
    assert.equal(getProviderMode(), "disabled");
  });

  test("mock is allowed in dev but not prod-like; the old override no longer permits it", () => {
    process.env["PLATFORM_ENV"] = "development";
    assert.equal(mockAllowedHere(), true);
    process.env["PLATFORM_ENV"] = "production";
    assert.equal(mockAllowedHere(), false);
    process.env["ALLOW_MOCK_IDP_IN_PROD_UNTIL_REAL_PROVIDERS"] = "true";
    assert.equal(mockAllowedHere(), false);
    process.env["AUTH_PROVIDER_MODE"] = "mock";
    assert.throws(() => validateProviderModeAtStartup(), /no longer accepted/);
  });
});

describe("resolveProviderHint (kc_idp_hint mapping + injection guard)", () => {
  test("platform resolves to a null hint (normal Keycloak login)", () => {
    const r = resolveProviderHint("platform");
    assert.deepEqual(r, { ok: true, id: "platform", idpHint: null });
  });

  test("omitted provider defaults to platform", () => {
    const r = resolveProviderHint(null);
    assert.equal(r.ok && r.id, "platform");
  });

  test("google maps to the mock broker alias in mock mode", () => {
    process.env["AUTH_PROVIDER_MODE"] = "mock";
    const r = resolveProviderHint("google");
    assert.deepEqual(r, { ok: true, id: "google", idpHint: "mock-google" });
  });

  test("rejects unknown providers (no arbitrary kc_idp_hint injection)", () => {
    assert.deepEqual(resolveProviderHint("evil"), { ok: false });
    assert.deepEqual(resolveProviderHint("mock-google"), { ok: false });
    assert.deepEqual(resolveProviderHint("../../admin"), { ok: false });
    assert.deepEqual(resolveProviderHint("google&kc_idp_hint=x"), { ok: false });
  });

  test("rejects a third-party provider that is disabled in the current mode", () => {
    process.env["AUTH_PROVIDER_MODE"] = "disabled";
    assert.deepEqual(resolveProviderHint("google"), { ok: false });
  });

  test("rejects mock provider in prod-like env without the override", () => {
    process.env["PLATFORM_ENV"] = "production";
    process.env["AUTH_PROVIDER_MODE"] = "mock";
    assert.deepEqual(resolveProviderHint("google"), { ok: false });
  });
});

describe("brokerAliasFor", () => {
  test("maps product id to mock/real alias and platform to null", () => {
    assert.equal(brokerAliasFor("google", "mock"), "mock-google");
    assert.equal(brokerAliasFor("google", "real"), "google");
    assert.equal(brokerAliasFor("platform", "mock"), null);
  });
});

describe("listEnabledProviders", () => {
  test("mock mode lists platform + three brokered providers, all via the BFF", () => {
    process.env["AUTH_PROVIDER_MODE"] = "mock";
    const list = listEnabledProviders();
    assert.deepEqual(list.map((p) => p.id).sort(), ["apple", "azure", "google", "platform"]);
    for (const p of list) {
      assert.equal(p.loginUrl, `/auth/login?provider=${p.id}`);
      assert.ok(!p.loginUrl.includes("kc_idp_hint"));
    }
    assert.equal(list.find((p) => p.id === "platform")!.mode, "internal");
    assert.equal(list.find((p) => p.id === "google")!.mode, "mock");
  });

  test("real mode with no real config shows only the platform login", () => {
    process.env["AUTH_PROVIDER_MODE"] = "real";
    assert.deepEqual(
      listEnabledProviders().map((p) => p.id),
      ["platform"]
    );
  });

  test("real mode advertises a provider once its real config is present", () => {
    process.env["AUTH_PROVIDER_MODE"] = "real";
    process.env["REAL_GOOGLE_ISSUER"] = "https://accounts.google.com";
    process.env["REAL_GOOGLE_CLIENT_ID"] = "real-client";
    process.env["REAL_GOOGLE_CLIENT_SECRET"] = "real-secret";
    const ids = listEnabledProviders().map((p) => p.id);
    assert.ok(ids.includes("google"));
    assert.ok(!ids.includes("azure"));
  });

  test("disabled mode shows only the platform login", () => {
    process.env["AUTH_PROVIDER_MODE"] = "disabled";
    assert.deepEqual(
      listEnabledProviders().map((p) => p.id),
      ["platform"]
    );
  });

  test("never leaks secrets in the provider list payload", () => {
    process.env["AUTH_PROVIDER_MODE"] = "mock";
    process.env["MOCK_OIDC_CLIENT_SECRET"] = "super-secret-value";
    const serialized = JSON.stringify(listEnabledProviders());
    assert.ok(!serialized.includes("super-secret-value"));
    assert.ok(!/secret/i.test(serialized));
    assert.ok(!/clientSecret/.test(serialized));
  });
});

describe("buildMockIdpDefinitions", () => {
  test("splits front (public) and back (internal) channel endpoints", () => {
    const defs = buildMockIdpDefinitions({
      publicUrl: "http://localhost:9080",
      internalUrl: "http://host.docker.internal:9080",
      clientSecret: "shh",
    });
    assert.deepEqual(defs.map((d) => d.alias).sort(), ["mock-apple", "mock-azure", "mock-google"]);
    const google = defs.find((d) => d.alias === "mock-google")!;
    assert.equal(google.providerId, "oidc");
    assert.equal(google.config["authorizationUrl"], "http://localhost:9080/google/auth");
    assert.equal(google.config["tokenUrl"], "http://host.docker.internal:9080/google/token");
    assert.equal(google.config["jwksUrl"], "http://host.docker.internal:9080/google/jwks");
    assert.equal(google.config["issuer"], "http://localhost:9080/google");
    assert.equal(google.config["clientId"], "kc-broker-google");
    assert.equal(google.config["pkceEnabled"], "false");
  });
});

describe("buildAuthorizationUrl idpHint", () => {
  const cfg = {
    url: "http://kc:8080",
    realm: "platform",
    clientId: "platform-api",
    clientSecret: "x",
    publicUrl: "http://localhost:8090/kc",
  };
  test("appends kc_idp_hint when an idpHint is given", () => {
    const url = buildAuthorizationUrl(
      { state: "s", codeChallenge: "c", redirectUri: "http://app/cb", idpHint: "mock-google" },
      cfg
    );
    assert.ok(url.includes("kc_idp_hint=mock-google"));
  });
  test("omits kc_idp_hint for the platform login", () => {
    const url = buildAuthorizationUrl(
      { state: "s", codeChallenge: "c", redirectUri: "http://app/cb" },
      cfg
    );
    assert.ok(!url.includes("kc_idp_hint"));
  });
});

describe("validateProviderModeAtStartup (guardrails)", () => {
  test("throws when mock is used in prod-like env without the override", () => {
    process.env["PLATFORM_ENV"] = "production";
    process.env["AUTH_PROVIDER_MODE"] = "mock";
    assert.throws(() => validateProviderModeAtStartup(), /refused in 'production'/);
  });

  test("rejects mock in prod-like env even with the retired override", () => {
    process.env["PLATFORM_ENV"] = "staging";
    process.env["AUTH_PROVIDER_MODE"] = "mock";
    process.env["ALLOW_MOCK_IDP_IN_PROD_UNTIL_REAL_PROVIDERS"] = "true";
    assert.throws(() => validateProviderModeAtStartup(), /no longer accepted/);
  });

  test("throws when AUTH_PROVIDER_MODE=real is explicit but no real provider configured", () => {
    process.env["PLATFORM_ENV"] = "production";
    process.env["AUTH_PROVIDER_MODE"] = "real";
    assert.throws(() => validateProviderModeAtStartup(), /no real provider is configured/);
  });

  test("allows explicit real mode when a real provider is configured", () => {
    process.env["PLATFORM_ENV"] = "production";
    process.env["AUTH_PROVIDER_MODE"] = "real";
    process.env["REAL_GOOGLE_ISSUER"] = "https://accounts.google.com";
    process.env["REAL_GOOGLE_CLIENT_ID"] = "real-client";
    process.env["REAL_GOOGLE_CLIENT_SECRET"] = "real-secret";
    assert.deepEqual(validateProviderModeAtStartup(), []);
  });

  test("does not throw for the default (dev → mock)", () => {
    process.env["PLATFORM_ENV"] = "development";
    assert.deepEqual(validateProviderModeAtStartup(), []);
  });

  test("empty AUTH_PROVIDER_MODE is treated as unset, not explicit real (prod-like)", () => {
    // compose passes AUTH_PROVIDER_MODE="" for envs that don't set it. With
    // PLATFORM_ENV/NODE_ENV prod-like the default mode is "real", but because the
    // value is blank (not explicit) the "real with no provider" guard must NOT fire,
    // matching an absent variable — otherwise test/staging containers crash on boot.
    process.env["PLATFORM_ENV"] = "production";
    process.env["AUTH_PROVIDER_MODE"] = "";
    assert.deepEqual(validateProviderModeAtStartup(), []);
  });
});
