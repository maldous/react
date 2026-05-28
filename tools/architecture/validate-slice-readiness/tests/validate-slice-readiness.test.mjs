#!/usr/bin/env node
import assert from "node:assert/strict";
import { test } from "node:test";
import { validateManifest } from "../src/index.mjs";

// ── Valid ADR-ACT-0008 manifest passes ──────────────────────────────────────
test("valid ADR-ACT-0008 manifest passes validation", () => {
  const manifest = {
    actionId: "ADR-ACT-0008",
    name: "Authenticated organisation profile slice",
    description: "First vertical slice",
    requiredReadinessTier: 1,
    requiredCapabilities: [
      "local-postgres",
      "platform-api",
      "react-spa",
      "fixture-session",
      "playwright-e2e",
      "structured-logging",
      "permission-guards",
    ],
    blockedBy: ["ADR-ACT-0112", "ADR-ACT-0113"],
    allowedFixtureModes: ["fixture-session"],
    forbiddenDependencies: ["live-keycloak"],
    status: "not-started",
    adrRef: "ADR-0024",
    notes: "test",
  };

  const issues = validateManifest(manifest, "ADR-ACT-0008.json");
  const errors = issues.filter((i) => i.startsWith("ERROR:"));
  assert.equal(errors.length, 0, `Expected no errors, got: ${errors.join(", ")}`);
});

// ── Missing requiredReadinessTier fails ──────────────────────────────────────
test("missing requiredReadinessTier fails", () => {
  const manifest = {
    actionId: "ADR-ACT-0001",
    name: "Test slice",
    status: "not-started",
    requiredCapabilities: ["local-postgres"],
    // requiredReadinessTier is intentionally omitted
  };

  const issues = validateManifest(manifest, "test.json");
  const errors = issues.filter((i) => i.startsWith("ERROR:"));
  assert.ok(
    errors.some((e) => e.includes("requiredReadinessTier")),
    `Expected error about requiredReadinessTier, got: ${errors.join(", ")}`
  );
});

// ── Invalid tier (5) fails ───────────────────────────────────────────────────
test("invalid tier value 5 fails validation", () => {
  const manifest = {
    actionId: "ADR-ACT-0001",
    name: "Test slice",
    status: "not-started",
    requiredReadinessTier: 5,
    requiredCapabilities: [],
  };

  const issues = validateManifest(manifest, "test.json");
  const errors = issues.filter((i) => i.startsWith("ERROR:"));
  assert.ok(
    errors.some((e) => e.includes("requiredReadinessTier must be 0-4")),
    `Expected tier range error, got: ${errors.join(", ")}`
  );
});

// ── Unknown capability fails ─────────────────────────────────────────────────
test("unknown capability fails validation", () => {
  const manifest = {
    actionId: "ADR-ACT-0001",
    name: "Test slice",
    status: "not-started",
    requiredReadinessTier: 1,
    requiredCapabilities: ["local-postgres", "nonexistent-capability"],
  };

  const issues = validateManifest(manifest, "test.json");
  const errors = issues.filter((i) => i.startsWith("ERROR:"));
  assert.ok(
    errors.some((e) => e.includes("Unknown capability: nonexistent-capability")),
    `Expected unknown capability error, got: ${errors.join(", ")}`
  );
});

// ── Invalid blocker format fails ─────────────────────────────────────────────
test("invalid blocker format fails validation", () => {
  const manifest = {
    actionId: "ADR-ACT-0001",
    name: "Test slice",
    status: "not-started",
    requiredReadinessTier: 0,
    requiredCapabilities: [],
    blockedBy: ["ADR-ACT-0112", "INVALID-FORMAT"],
  };

  const issues = validateManifest(manifest, "test.json");
  const errors = issues.filter((i) => i.startsWith("ERROR:"));
  assert.ok(
    errors.some((e) => e.includes("Invalid blocker format: INVALID-FORMAT")),
    `Expected blocker format error, got: ${errors.join(", ")}`
  );
});

// ── Missing status fails ─────────────────────────────────────────────────────
test("missing status fails validation", () => {
  const manifest = {
    actionId: "ADR-ACT-0001",
    name: "Test slice",
    requiredReadinessTier: 0,
    requiredCapabilities: [],
  };

  const issues = validateManifest(manifest, "test.json");
  const errors = issues.filter((i) => i.startsWith("ERROR:"));
  assert.ok(
    errors.some((e) => e.includes("Missing status")),
    `Expected missing status error, got: ${errors.join(", ")}`
  );
});

// ── Valid unknown forbidden dependency warns (not error) ─────────────────────
test("unrecognised forbidden dependency produces warning not error", () => {
  const manifest = {
    actionId: "ADR-ACT-0001",
    name: "Test slice",
    status: "not-started",
    requiredReadinessTier: 0,
    requiredCapabilities: [],
    forbiddenDependencies: ["some-future-dep"],
  };

  const issues = validateManifest(manifest, "test.json");
  const errors = issues.filter((i) => i.startsWith("ERROR:"));
  const warnings = issues.filter((i) => i.startsWith("WARN:"));
  assert.equal(errors.length, 0, `Expected no errors, got: ${errors.join(", ")}`);
  assert.ok(
    warnings.some((w) => w.includes("Unrecognised forbidden dependency: some-future-dep")),
    `Expected warning about unrecognised dep, got: ${warnings.join(", ")}`
  );
});
