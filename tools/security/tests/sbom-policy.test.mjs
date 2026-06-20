#!/usr/bin/env node
/**
 * Tests for tools/security/sbom-policy.mjs — ADR-ACT-0247 / V1C-18.
 *
 * Tests the SPDX expression parser, license normalization, and blocked-license
 * detection by importing the real exported functions from sbom-policy.mjs.
 *
 * Covers the specific expressions requested:
 *   - MIT OR GPL-3.0       → should pass (user can choose MIT)
 *   - MIT AND GPL-3.0      → should fail (must accept GPL-3.0)
 *   - GPL-3.0 OR AGPL-3.0  → should fail (all alternatives blocked)
 *   - Commons Clause / Commons-Clause / LicenseRef-Commons-Clause → should fail
 *   - BUSL-1.1             → should fail
 *
 * Also exercises parenthesized groups and WITH handling.
 *
 * Uses Node built-in test runner.
 * Run: node --test tools/security/tests/sbom-policy.test.mjs
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  tokenize,
  normalizeLicense,
  isExpressionBlocked,
  isBlockedLicense,
} from "../sbom-policy.mjs";

// ── Tests ──────────────────────────────────────────────────────────────────

describe("SPDX expression parsing", () => {
  describe("user-specified cases", () => {
    // MIT OR GPL-3.0 → user can choose MIT, so NOT blocked
    it("MIT OR GPL-3.0 should pass (user can choose MIT)", () => {
      assert.strictEqual(
        isExpressionBlocked("MIT OR GPL-3.0"),
        false,
        "MIT OR GPL-3.0 should NOT be blocked — user can choose MIT"
      );
    });

    // MIT AND GPL-3.0 → must accept BOTH, so IS blocked
    it("MIT AND GPL-3.0 should fail (must accept GPL-3.0)", () => {
      assert.strictEqual(
        isExpressionBlocked("MIT AND GPL-3.0"),
        true,
        "MIT AND GPL-3.0 should be blocked — user must accept GPL-3.0"
      );
    });

    // GPL-3.0 OR AGPL-3.0 → ALL alternatives are blocked → IS blocked
    it("GPL-3.0 OR AGPL-3.0 should fail (all alternatives blocked)", () => {
      assert.strictEqual(
        isExpressionBlocked("GPL-3.0 OR AGPL-3.0"),
        true,
        "GPL-3.0 OR AGPL-3.0 should be blocked — all alternatives are flagged"
      );
    });

    // Commons Clause variants
    it('"Commons Clause" should fail', () => {
      assert.strictEqual(
        isExpressionBlocked("Commons Clause"),
        true,
        "Commons Clause should be blocked via alias"
      );
    });

    it('"Commons-Clause" should fail', () => {
      assert.strictEqual(
        isExpressionBlocked("Commons-Clause"),
        true,
        "Commons-Clause should be blocked via alias"
      );
    });

    it('"LicenseRef-Commons-Clause" should fail', () => {
      assert.strictEqual(
        isExpressionBlocked("LicenseRef-Commons-Clause"),
        true,
        "LicenseRef-Commons-Clause should be blocked directly"
      );
    });

    // BUSL-1.1
    it("BUSL-1.1 should fail", () => {
      assert.strictEqual(isExpressionBlocked("BUSL-1.1"), true, "BUSL-1.1 should be blocked");
    });
  });

  describe("additional SPDX expression variants", () => {
    it("single permissive license (MIT) is not blocked", () => {
      assert.strictEqual(isExpressionBlocked("MIT"), false);
    });

    it("single permissive license (Apache-2.0) is not blocked", () => {
      assert.strictEqual(isExpressionBlocked("Apache-2.0"), false);
    });

    it("single blocked license (GPL-3.0-only) is blocked", () => {
      assert.strictEqual(isExpressionBlocked("GPL-3.0-only"), true);
    });

    it("single blocked license (AGPL-3.0) is blocked", () => {
      assert.strictEqual(isExpressionBlocked("AGPL-3.0"), true);
    });

    it("SSPL-1.0 is blocked", () => {
      assert.strictEqual(isExpressionBlocked("SSPL-1.0"), true);
    });

    it("MIT OR Apache-2.0 (both permissive) is not blocked", () => {
      assert.strictEqual(isExpressionBlocked("MIT OR Apache-2.0"), false);
    });

    it("MIT AND Apache-2.0 (both permissive) is not blocked", () => {
      assert.strictEqual(isExpressionBlocked("MIT AND Apache-2.0"), false);
    });

    it("(MIT OR GPL-3.0) AND Apache-2.0 is NOT blocked (user can choose MIT, avoiding GPL)", () => {
      assert.strictEqual(
        isExpressionBlocked("(MIT OR GPL-3.0) AND Apache-2.0"),
        false,
        "user can choose MIT from the OR and Apache-2.0 is permissive"
      );
    });

    it("MIT AND (GPL-3.0 OR Apache-2.0) is NOT blocked (user can choose Apache-2.0)", () => {
      assert.strictEqual(
        isExpressionBlocked("MIT AND (GPL-3.0 OR Apache-2.0)"),
        false,
        "MIT AND permissive → not blocked; user can avoid GPL-3.0 by choosing Apache-2.0"
      );
    });

    it("MIT WITH Classpath-exception-2.0 is not blocked (exception doesn't affect blocking)", () => {
      assert.strictEqual(
        isExpressionBlocked("MIT WITH Classpath-exception-2.0"),
        false,
        "WITH exception does not introduce blocking"
      );
    });

    it("GPL-3.0 WITH Classpath-exception-2.0 is blocked (base license is GPL)", () => {
      assert.strictEqual(
        isExpressionBlocked("GPL-3.0 WITH Classpath-exception-2.0"),
        true,
        "WITH exception does not remove GPL blocking"
      );
    });

    it("parenthesized: MIT AND (GPL-3.0-only AND AGPL-3.0) is blocked (no escape)", () => {
      assert.strictEqual(
        isExpressionBlocked("MIT AND (GPL-3.0-only AND AGPL-3.0)"),
        true,
        "MIT AND blocked AND blocked → blocked; no permissive path exists"
      );
    });

    it("nested: (MIT OR Apache-2.0) AND (BSD-3-Clause OR MIT) is not blocked", () => {
      assert.strictEqual(
        isExpressionBlocked("(MIT OR Apache-2.0) AND (BSD-3-Clause OR MIT)"),
        false,
        "all paths are permissive through deep nesting"
      );
    });

    it("empty expression is not blocked", () => {
      assert.strictEqual(isExpressionBlocked(""), false);
    });

    it("LicenseRef-custom-id (not in blocked set) is not blocked", () => {
      assert.strictEqual(
        isExpressionBlocked("LicenseRef-custom-proprietary"),
        false,
        "unknown LicenseRef not in blocked set"
      );
    });
  });

  describe("normalizeLicense", () => {
    it("maps Commons Clause alias to LicenseRef-Commons-Clause", () => {
      assert.strictEqual(normalizeLicense("Commons Clause"), "LicenseRef-Commons-Clause");
    });

    it("maps Commons-Clause alias", () => {
      assert.strictEqual(normalizeLicense("Commons-Clause"), "LicenseRef-Commons-Clause");
    });

    it("detects commons-scancode variant via substring", () => {
      assert.strictEqual(
        normalizeLicense("LicenseRef-scancode-commons-clause"),
        "LicenseRef-Commons-Clause"
      );
    });

    it("passes through unknown IDs unchanged", () => {
      assert.strictEqual(normalizeLicense("MIT"), "MIT");
      assert.strictEqual(normalizeLicense("Apache-2.0"), "Apache-2.0");
    });
  });

  describe("tokenize", () => {
    it("tokenizes a simple license ID", () => {
      const tokens = tokenize("MIT");
      assert.deepStrictEqual(tokens, ["MIT"]);
    });

    it("tokenizes an OR expression", () => {
      const tokens = tokenize("MIT OR GPL-3.0");
      assert.deepStrictEqual(tokens, ["MIT", "OR", "GPL-3.0"]);
    });

    it("tokenizes a parenthesized expression", () => {
      const tokens = tokenize("(MIT OR Apache-2.0)");
      assert.deepStrictEqual(tokens, ["(", "MIT", "OR", "Apache-2.0", ")"]);
    });

    it("tokenizes a WITH expression", () => {
      const tokens = tokenize("MIT WITH Classpath-exception-2.0");
      assert.deepStrictEqual(tokens, ["MIT", "WITH", "Classpath-exception-2.0"]);
    });

    it("returns null for empty expression", () => {
      assert.strictEqual(tokenize(""), null);
    });
  });

  describe("isBlockedLicense", () => {
    it("returns true for GPL-3.0", () => {
      assert.strictEqual(isBlockedLicense("GPL-3.0"), true);
    });

    it("returns true for AGPL-3.0", () => {
      assert.strictEqual(isBlockedLicense("AGPL-3.0"), true);
    });

    it("returns true for BUSL-1.1", () => {
      assert.strictEqual(isBlockedLicense("BUSL-1.1"), true);
    });

    it("returns false for MIT", () => {
      assert.strictEqual(isBlockedLicense("MIT"), false);
    });

    it("returns false for Apache-2.0", () => {
      assert.strictEqual(isBlockedLicense("Apache-2.0"), false);
    });
  });
});
