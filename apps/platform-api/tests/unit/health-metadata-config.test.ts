import { test } from "node:test";
import assert from "node:assert/strict";
import { loadHealthMetadataConfig } from "../../src/config/health-metadata-config.ts";

test("health metadata fields are optional → undefined when unset (call site applies || default)", () => {
  const cfg = loadHealthMetadataConfig({ source: {} });
  assert.equal(cfg.appVersion, undefined);
  assert.equal(cfg.gitSha, undefined);
  assert.equal(cfg.buildTime, undefined);
  // loadConfig maps empty-string identically to unset (→ undefined for optional),
  // which exactly reproduces the prior `process.env[X] || "default"` (empty → default).
  const empty = loadHealthMetadataConfig({ source: { APP_VERSION: "" } });
  assert.equal(empty.appVersion, undefined);
  assert.equal(empty.appVersion || "0.1.0", "0.1.0");
});

test("set values pass through", () => {
  const cfg = loadHealthMetadataConfig({
    source: { APP_VERSION: "1.2.3", GIT_SHA: "abc", BUILD_TIME: "t" },
  });
  assert.equal(cfg.appVersion, "1.2.3");
  assert.equal(cfg.gitSha, "abc");
  assert.equal(cfg.buildTime, "t");
});
