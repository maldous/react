import { test } from "node:test";
import assert from "node:assert/strict";
import { loadStageConfig, resolveStage } from "../../src/config/stage-config.ts";

test("stage resolves PLATFORM_ENV → NODE_ENV → development (preserves prior chain)", () => {
  assert.equal(
    resolveStage(loadStageConfig({ source: { PLATFORM_ENV: "prod", NODE_ENV: "x" } })),
    "prod"
  );
  assert.equal(resolveStage(loadStageConfig({ source: { NODE_ENV: "test" } })), "test");
  assert.equal(resolveStage(loadStageConfig({ source: {} })), "development");
});

test("raw values stay independently readable (call sites use distinct expressions)", () => {
  // graphql/routes read PLATFORM_ENV only; forward-auth/health read NODE_ENV only.
  const cfg = loadStageConfig({ source: { NODE_ENV: "production" } });
  assert.equal(cfg.platformEnv, undefined); // PLATFORM_ENV-only checks must NOT see NODE_ENV
  assert.equal(cfg.nodeEnv, "production");
});
