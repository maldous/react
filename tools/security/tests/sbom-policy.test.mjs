#!/usr/bin/env node
/**
 * Tests for tools/security/sbom-policy.mjs — ADR-ACT-0247 / V1C-18.
 *
 * Tests the SPDX expression parser, license normalization, and blocked-license
 * detection. Covers the specific expressions requested:
 *   - MIT OR GPL-3.0       → should pass (user can choose MIT)
 *   - MIT AND GPL-3.0      → should fail (must accept GPL-3.0)
 *   - GPL-3.0 OR AGPL-3.0  → should fail (all alternatives blocked)
 *   - Commons Clause / Commons-Clause / LicenseRef-Commons-Clause → should fail
 *   - BUSL-1.1             → should fail
 *
 * Also exercises parenthesized groups and WITH handling.
 *
 * NOTE: The SPDX parser, tokenizer, and license policy constants below are
 * duplicated from sbom-policy.mjs (canonical source of truth). The script
 * uses process.exit() and doesn't export its internals, so we replicate the
 * logic here for isolated unit testing. Keep in sync with the source.
 *
 * Uses Node built-in test runner.
 * Run: node --test tools/security/tests/sbom-policy.test.mjs
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

// ── Copy of the SPDX parser logic from sbom-policy.mjs ─────────────────────
// Duplicated here so the tests are self-contained and don't depend on
// the script's module export structure (which uses process.exit, etc.)

const BLOCKED_LICENSES = new Set([
  "GPL-1.0",
  "GPL-1.0-only",
  "GPL-1.0-or-later",
  "GPL-2.0",
  "GPL-2.0-only",
  "GPL-2.0-or-later",
  "GPL-2.0-with-autoconf-exception",
  "GPL-2.0-with-bison-exception",
  "GPL-2.0-with-classpath-exception",
  "GPL-2.0-with-font-exception",
  "GPL-2.0-with-GCC-exception",
  "GPL-3.0",
  "GPL-3.0-only",
  "GPL-3.0-or-later",
  "GPL-3.0-with-autoconf-exception",
  "GPL-3.0-with-GCC-exception",
  "AGPL-1.0",
  "AGPL-1.0-only",
  "AGPL-1.0-or-later",
  "AGPL-3.0",
  "AGPL-3.0-only",
  "AGPL-3.0-or-later",
  "SSPL-1.0",
  "LicenseRef-Commons-Clause",
  "BUSL-1.1",
]);

const BLOCKED_ALIASES = new Map([
  ["Commons Clause", "LicenseRef-Commons-Clause"],
  ["Commons-Clause", "LicenseRef-Commons-Clause"],
]);

const TOKEN_RE =
  /\b(?:AND|OR|WITH)\b|\(|\)|(?:LicenseRef-[A-Za-z0-9\-_.+]+|[A-Za-z0-9](?:[A-Za-z0-9\-_.+]*[A-Za-z0-9])?)/g;

function tokenize(expr) {
  const tokens = [];
  let m;
  while ((m = TOKEN_RE.exec(expr)) !== null) {
    tokens.push(m[0]);
  }
  return tokens.length > 0 ? tokens : null;
}

function normalizeLicense(id) {
  if (!id || typeof id !== "string") return "";
  const trimmed = id.trim();
  if (trimmed.startsWith("LicenseRef-")) {
    if (trimmed.toLowerCase().includes("commons-clause")) {
      return "LicenseRef-Commons-Clause";
    }
    return trimmed;
  }
  if (trimmed.toLowerCase().includes("commons")) {
    return "LicenseRef-Commons-Clause";
  }
  if (BLOCKED_ALIASES.has(trimmed)) return BLOCKED_ALIASES.get(trimmed);
  return trimmed;
}

function isBlockedLicense(id) {
  return BLOCKED_LICENSES.has(id);
}

class SpdxParser {
  constructor(tokens) {
    this.tokens = tokens;
    this.pos = 0;
  }

  peek() {
    return this.pos < this.tokens.length ? this.tokens[this.pos] : null;
  }

  consume() {
    return this.pos < this.tokens.length ? this.tokens[this.pos++] : null;
  }

  parseExpression() {
    let result = this.parseTerm();
    if (result === null) return null;

    while (true) {
      const op = this.peek();
      if (op === "AND" || op === "OR") {
        this.consume();
        const right = this.parseTerm();
        if (right === null) return null;

        if (op === "AND") {
          result = result && right;
        } else {
          result = result || right;
        }
      } else {
        break;
      }
    }

    return result;
  }

  parseTerm() {
    const token = this.peek();
    if (token === null) return null;

    if (token === "(") {
      this.consume();
      const inner = this.parseExpression();
      if (inner === null) return null;
      const close = this.consume();
      if (close !== ")") return null;
      return inner;
    }

    this.consume();
    const normalized = normalizeLicense(token);
    let result = !isBlockedLicense(normalized);

    if (this.peek() === "WITH") {
      this.consume();
      this.consume();
    }

    return result;
  }
}

function isExpressionBlocked(expr) {
  const tok = tokenize(expr);
  if (!tok) return false;

  const parser = new SpdxParser(tok);
  const result = parser.parseExpression();

  if (result === null) {
    const licenseTokens = tok.filter(
      (t) => t !== "AND" && t !== "OR" && t !== "WITH" && t !== "(" && t !== ")"
    );
    return licenseTokens.some((t) => isBlockedLicense(normalizeLicense(t)));
  }

  return !result;
}

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
});
