#!/usr/bin/env node
/**
 * Tests for tools/security/sbom-verify.mjs — ADR-ACT-0247 / V1C-18.
 *
 * Tests the local vs authoritative freshness mismatch behaviour,
 * missing lockhash in CI fail-closed, and the core check/warn/fatal helpers.
 *
 * Uses Node built-in test runner for minimal dependencies.
 * Run: node --test tools/security/tests/sbom-verify.test.mjs
 */

import { describe, it, before, after } from "node:test";
import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash as createHashCrypto } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..", "..");
const VERIFY_SCRIPT = resolve(ROOT, "tools", "security", "sbom-verify.mjs");
const LOCKHASH_PATH = resolve(ROOT, "docs", "evidence", "security", "sbom-baseline.lockhash");

function runVerify(env = {}) {
  return spawnSync(process.execPath, [VERIFY_SCRIPT], {
    cwd: ROOT,
    env: { ...process.env, ...env },
    encoding: "utf8",
    timeout: 15_000,
  });
}

describe("sbom-verify local vs authoritative freshness behaviour", () => {
  let savedHash = null;

  before(() => {
    // Save the current lockfile hash so we can restore it after
    if (existsSync(LOCKHASH_PATH)) {
      savedHash = readFileSync(LOCKHASH_PATH, "utf8");
    }
  });

  after(() => {
    // Restore the original hash
    if (savedHash !== null) {
      writeFileSync(LOCKHASH_PATH, savedHash, "utf8");
    } else if (existsSync(LOCKHASH_PATH)) {
      unlinkSync(LOCKHASH_PATH);
    }
  });

  it("hash match in local mode exits 0 with PASS", () => {
    // Ensure the hash matches by writing current hash
    const currentHash = createHashCrypto("sha256")
      .update(readFileSync(resolve(ROOT, "package-lock.json"), "utf8"))
      .digest("hex");
    writeFileSync(LOCKHASH_PATH, `${currentHash}\n`, "utf8");

    const result = runVerify();
    assert.strictEqual(result.status, 0, "exit code should be 0");
    assert.ok(result.stdout.includes("SBOM VERIFY PASSED"), "output should contain PASSED");
  });

  it("hash mismatch in local mode exits 0 (advisory warn, not fail)", () => {
    // Write a deliberately wrong hash to simulate lockfile change
    writeFileSync(
      LOCKHASH_PATH,
      "0000000000000000000000000000000000000000000000000000000000000000\n",
      "utf8"
    );

    const result = runVerify();
    assert.strictEqual(result.status, 0, "local mismatch must exit 0 (advisory only)");
    assert.ok(result.stdout.includes("WARN"), "output should contain WARN advisory");
    assert.ok(result.stdout.includes("regenerate with"), "output should mention regeneration");
    assert.ok(
      result.stdout.includes("SBOM VERIFY PASSED"),
      "local mode should still report PASSED after advisory warn"
    );
  });

  it("hash mismatch in authoritative mode exits 1 (fail-closed)", () => {
    writeFileSync(
      LOCKHASH_PATH,
      "0000000000000000000000000000000000000000000000000000000000000000\n",
      "utf8"
    );

    const result = runVerify({ AUTHORITATIVE_SCAN: "true" });
    assert.strictEqual(result.status, 1, "authoritative mismatch must exit 1");
    assert.ok(result.stderr.includes("SBOM VERIFY FAILED"), "stderr should contain FAILED");
    assert.ok(result.stdout.includes("FAIL"), "stdout should contain FAIL entry");
    assert.ok(result.stdout.includes("semantically fresh"), "FAIL should be about freshness");
  });

  it("hash match in authoritative mode exits 0", () => {
    const currentHash = createHashCrypto("sha256")
      .update(readFileSync(resolve(ROOT, "package-lock.json"), "utf8"))
      .digest("hex");
    writeFileSync(LOCKHASH_PATH, `${currentHash}\n`, "utf8");

    const result = runVerify({ AUTHORITATIVE_SCAN: "true" });
    assert.strictEqual(result.status, 0, "authoritative match exits 0");
    assert.ok(
      result.stdout.includes("SBOM VERIFY PASSED (authoritative)"),
      "output should contain authoritative PASSED"
    );
  });

  it("missing lockhash in CI exits 1 (fail-closed)", () => {
    // Remove the hash file
    if (existsSync(LOCKHASH_PATH)) {
      unlinkSync(LOCKHASH_PATH);
    }

    const result = runVerify({ CI: "true" });
    assert.strictEqual(result.status, 1, "missing lockhash in CI exits 1");
    assert.ok(result.stderr.includes("SBOM VERIFY FAILED"), "stderr should contain FAILED");
  });

  it("missing lockhash in local mode exits 0 (establishes baseline)", () => {
    if (existsSync(LOCKHASH_PATH)) {
      unlinkSync(LOCKHASH_PATH);
    }

    const result = runVerify();
    assert.strictEqual(result.status, 0, "local missing lockhash exits 0");
    assert.ok(
      result.stdout.includes("No lockfile hash on record"),
      "should warn about establishing baseline"
    );
    assert.ok(existsSync(LOCKHASH_PATH), "lockhash file should have been created");
  });

  it("CI=true also triggers authoritative mode", () => {
    writeFileSync(
      LOCKHASH_PATH,
      "0000000000000000000000000000000000000000000000000000000000000000\n",
      "utf8"
    );

    const result = runVerify({ CI: "true" });
    assert.strictEqual(result.status, 1, "CI with mismatch exits 1");
  });
});
