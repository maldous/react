import { test } from "node:test";
import assert from "node:assert/strict";
import {
  loadConfig,
  configMetadata,
  ConfigError,
  type ConfigSchema,
} from "@platform/config-runtime";
import {
  loadPlatformApiConfig,
  platformApiConfigMetadata,
  PLATFORM_API_CONFIG_SCHEMA,
} from "../../src/config/app-config.ts";

const SCHEMA = {
  port: { key: "T_PORT", type: "number", default: 3000 },
  name: { key: "T_NAME", type: "string" }, // required
  secretKey: { key: "T_SECRET", type: "string", default: "x", secret: true },
  flag: { key: "T_FLAG", type: "boolean", default: false, restartOrReload: "reloadable" },
} as const satisfies ConfigSchema;

test("missing required production config fails (fail-closed, no fallback)", () => {
  assert.throws(() => loadConfig(SCHEMA, { source: {} }), ConfigError);
});

test("invalid typed value fails", () => {
  assert.throws(
    () => loadConfig(SCHEMA, { source: { T_NAME: "ok", T_PORT: "not-a-number" } }),
    /must be a number/
  );
});

test("unknown override key fails", () => {
  assert.throws(
    () => loadConfig(SCHEMA, { source: { T_NAME: "ok" }, overrides: { nope: 1 } as never }),
    /Unknown config override/
  );
});

test("valid typed overrides work (hermetic, no env)", () => {
  const cfg = loadConfig(SCHEMA, { source: {}, overrides: { name: "from-override", port: 9 } });
  assert.equal(cfg.name, "from-override");
  assert.equal(cfg.port, 9);
  assert.equal(cfg.flag, false); // default
});

test("immutable projection cannot be mutated", () => {
  const cfg = loadConfig(SCHEMA, { source: { T_NAME: "x" } });
  assert.throws(() => {
    (cfg as { port: number }).port = 1;
  }, TypeError);
  assert.ok(Object.isFrozen(cfg));
});

test("configMetadata never emits secret values + carries restart/reload classification", () => {
  const meta = configMetadata(SCHEMA);
  const secretField = meta.find((m) => m.field === "secretKey");
  assert.equal(secretField?.secret, true);
  assert.equal(secretField?.default, null, "secret default value must not be emitted");
  assert.equal(meta.find((m) => m.field === "flag")?.restartOrReload, "reloadable");
  assert.equal(meta.find((m) => m.field === "name")?.required, true);
});

test("PlatformApiConfig loads under the hermetic unit env (no generated stage secrets needed)", () => {
  // preload-unit-env sets fixed fake POSTGRES_URL/POSTGRES_APP_URL; defaults cover the rest.
  const cfg = loadPlatformApiConfig();
  assert.ok(cfg.postgresAppUrl.startsWith("postgresql://"));
  // env-independent: a real REDIS_URL/KEYCLOAK_REALM may be injected by the managed env (preload-env)
  // or fall back to the schema default (preload-unit-env). Assert shape, not a stage-specific value.
  assert.ok(cfg.redisUrl.startsWith("redis://"));
  assert.ok(typeof cfg.keycloakRealm === "string" && cfg.keycloakRealm.length > 0);
  assert.ok(Object.isFrozen(cfg));
});

test("PlatformApiConfig applies the schema default when an optional key is unset (hermetic)", () => {
  const cfg = loadPlatformApiConfig({ source: { POSTGRES_URL: "x", POSTGRES_APP_URL: "y" } });
  assert.equal(cfg.redisUrl, "redis://localhost:6379");
  assert.equal(cfg.keycloakRealm, "platform");
});

test("PlatformApiConfig metadata classifies secrets and omits their values", () => {
  const meta = platformApiConfigMetadata();
  const secret = meta.filter((m) => m.secret).map((m) => m.field);
  assert.ok(secret.includes("postgresUrl") && secret.includes("keycloakClientSecret"));
  for (const m of meta) if (m.secret) assert.equal(m.default, null);
  assert.equal(meta.length, Object.keys(PLATFORM_API_CONFIG_SCHEMA).length);
});

test("explicit typed override seam: a platform-api field can be overridden hermetically", () => {
  const cfg = loadPlatformApiConfig({
    source: {},
    overrides: { postgresUrl: "x", postgresAppUrl: "y", keycloakRealm: "custom" },
  });
  assert.equal(cfg.keycloakRealm, "custom");
  assert.equal(cfg.postgresAppUrl, "y");
});
