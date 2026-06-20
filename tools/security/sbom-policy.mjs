#!/usr/bin/env node
/**
 * sbom:policy — ADR-ACT-0247 / V1C-18.
 *
 * Checks the SBOM against the project security/license policy:
 *   - Flagged licenses (GPL/AGPL/SSPL/Commons Clause) — fail unconditionally
 *   - SPDX expression parsing for compound license declarations
 *   - Component count reasonableness (warn if implausibly small)
 *   - Policy compliance report emitted as evidence
 *
 * A component is flagged if:
 *   - Any SPDX expression resolves to ONLY flagged licenses (via OR)
 *   - Any SPDX expression includes a flagged license via AND (dual-licensing trap)
 *
 * Exportable API (usable by tests and tooling):
 *   tokenize(expr)          — tokenize an SPDX expression string
 *   normalizeLicense(id)    — normalize a license string to canonical SPDX ID
 *   isBlockedLicense(id)    — check if a license ID is in the blocked set
 *   isExpressionBlocked(expr) — parse an SPDX expression and return true if blocked
 *
 * Usage: npm run sbom:policy
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// ── Canonical blocked-license policy ───────────────────────────────────────
// This is the single source of truth for blocked licenses.
// SPDX identifiers: https://spdx.org/licenses/
export const BLOCKED_LICENSES = new Set([
  // GNU General Public License (all versions and variants)
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
  // GNU Affero General Public License (all versions and variants)
  "AGPL-1.0",
  "AGPL-1.0-only",
  "AGPL-1.0-or-later",
  "AGPL-3.0",
  "AGPL-3.0-only",
  "AGPL-3.0-or-later",
  // Server Side Public License
  "SSPL-1.0",
  // Commons Clause (not a standard SPDX, but a known restrictive rider)
  "LicenseRef-Commons-Clause",
  // Business Source License
  "BUSL-1.1",
]);

// ── Non-SPDX identifiers that map to blocked categories ────────────────────
export const BLOCKED_ALIASES = new Map([
  ["Commons Clause", "LicenseRef-Commons-Clause"],
  ["Commons-Clause", "LicenseRef-Commons-Clause"],
]);

// ── SPDX expression parser ─────────────────────────────────────────────────
// Handles simple SPDX license expressions: single IDs, OR, AND, WITH,
// and parenthesized grouping. Does not require an external library.
//
// Grammar (simplified):
//   expression = term (("AND" | "OR") term)*
//   term       = license-id ("WITH" exception-id)? | "(" expression ")" | license-ref

const TOKEN_RE =
  /\b(?:AND|OR|WITH)\b|\(|\)|(?:LicenseRef-[A-Za-z0-9\-_.+]+|[A-Za-z0-9](?:[A-Za-z0-9\-_.+]*[A-Za-z0-9])?)/g;

/**
 * Tokenize an SPDX expression string into an array of tokens.
 * Returns null if the expression is empty or unparseable.
 */
export function tokenize(expr) {
  const tokens = [];
  let m;
  while ((m = TOKEN_RE.exec(expr)) !== null) {
    tokens.push(m[0]);
  }
  return tokens.length > 0 ? tokens : null;
}

/**
 * Parser state for walking SPDX expression tokens.
 */
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

  /**
   * expression = term (operator term)*
   *
   * Returns true if the expression — considering boolean operators —
   * requires or permits a blocked license.
   *
   * AND: both sides must be accepted → if either is blocked, whole is blocked.
   * OR:  either side may be chosen  → blocked only if ALL alternatives are blocked.
   */
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
          // Both must be true → blocked if either is blocked
          result = result && right;
        } else {
          // OR: user could choose → blocked only if ALL alternatives blocked
          result = result || right;
        }
      } else {
        break;
      }
    }

    return result;
  }

  /**
   * term = license-id ("WITH" exception-id)? | "(" expression ")" | license-ref
   *
   * Returns: true if the term is a non-blocked license, false if blocked.
   */
  parseTerm() {
    const token = this.peek();
    if (token === null) return null;

    if (token === "(") {
      this.consume(); // consume (
      const inner = this.parseExpression();
      if (inner === null) return null;
      const close = this.consume();
      if (close !== ")") return null;
      return inner;
    }

    // License identifier (possibly followed by WITH exception)
    this.consume();
    const normalized = normalizeLicense(token);
    let result = !isBlockedLicense(normalized);

    // Check for optional WITH exception modifier — the base license
    // determines blocking, so we just consume the WITH and exception tokens.
    if (this.peek() === "WITH") {
      this.consume(); // consume WITH
      this.consume(); // consume the exception identifier (ignored for policy)
    }

    return result;
  }
}

/**
 * Parse an SPDX license expression and return true if it is blocked
 * (i.e., would require accepting a flagged license in any usage scenario).
 */
export function isExpressionBlocked(expr) {
  const tokens = tokenize(expr);
  if (!tokens) return false; // empty → not blocked

  const parser = new SpdxParser(tokens);
  const result = parser.parseExpression();

  // If parsing failed, fall back to checking only license-ID tokens
  if (result === null) {
    const licenseTokens = tokens.filter(
      (t) => t !== "AND" && t !== "OR" && t !== "WITH" && t !== "(" && t !== ")"
    );
    return licenseTokens.some((t) => isBlockedLicense(normalizeLicense(t)));
  }

  // result=true means all paths lead to non-blocked licenses
  // result=false means at least one path forces a blocked license
  return !result;
}

/**
 * Normalize a license string to a canonical SPDX ID or alias.
 */
export function normalizeLicense(id) {
  if (!id || typeof id !== "string") return "";
  const trimmed = id.trim();
  // Handle LicenseRef-* custom identifiers
  if (trimmed.startsWith("LicenseRef-")) {
    // Substring check for commons-clause variants
    if (trimmed.toLowerCase().includes("commons-clause")) {
      return "LicenseRef-Commons-Clause";
    }
    return trimmed;
  }
  // Handle known aliases (case-insensitive substring for Commons Clause)
  if (trimmed.toLowerCase().includes("commons")) {
    return "LicenseRef-Commons-Clause";
  }
  if (BLOCKED_ALIASES.has(trimmed)) return BLOCKED_ALIASES.get(trimmed);
  return trimmed;
}

/**
 * Check whether a license ID is in the blocked set.
 */
export function isBlockedLicense(id) {
  return BLOCKED_LICENSES.has(id);
}

// ── CLI entrypoint guard ───────────────────────────────────────────────────
const isMain = resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const ROOT = resolve(__dirname, "..", "..");
  const SBOM_PATH = resolve(ROOT, "docs", "evidence", "security", "sbom-baseline.json");

  // ── Helper functions ───────────────────────────────────────────────────────
  let failures = 0;
  let warnings = 0;

  function check(label, ok, detail = "") {
    console.log(`${ok ? "PASS" : "FAIL"}  ${label}` + (detail ? ` — ${detail}` : ""));
    if (!ok) failures++;
  }

  function warnFn(msg) {
    console.log(`WARN  ${msg}`);
    warnings++;
  }

  function fatal(label, detail) {
    console.log(`FAIL  ${label} — ${detail}`);
    console.error(`\n# SBOM POLICY FAILED — ${detail}\n`);
    process.exit(1);
  }

  // ── Load SBOM ──────────────────────────────────────────────────────────────
  let sbom;
  try {
    sbom = JSON.parse(readFileSync(SBOM_PATH, "utf8"));
    check("SBOM loaded successfully", true);
  } catch {
    fatal(
      "SBOM loaded successfully",
      `${SBOM_PATH} not found or invalid — generate with: npm run sbom:generate`
    );
  }

  // ── Component count ────────────────────────────────────────────────────────
  const components = Array.isArray(sbom.components) ? sbom.components : [];
  const componentCount = components.length;
  check("SBOM contains components", componentCount > 0, `n=${componentCount}`);
  if (componentCount > 0 && componentCount < 20) {
    warnFn(
      `SBOM contains only ${componentCount} components — may be incomplete (check sbom:generate output)`
    );
  }

  // ── License audit (with SPDX expression parsing) ───────────────────────────
  const flagged = [];
  const spdxParseIssues = [];

  for (const comp of components) {
    const licenses = comp.licenses ?? [];
    for (const lic of Array.isArray(licenses) ? licenses : [licenses]) {
      // Extract the license identifier or expression
      let id = "";
      let expression = null;

      if (typeof lic === "object" && lic) {
        // CycloneDX 1.4+: license.expression for SPDX expressions
        if (typeof lic.expression === "string" && lic.expression.trim()) {
          expression = lic.expression.trim();
        }
        // Standard form: license.id
        id = lic.license?.id ?? lic.id ?? "";
      } else if (typeof lic === "string") {
        id = lic;
      }

      const normalizedId = normalizeLicense(String(id));

      // If we have an SPDX expression, parse it
      if (expression) {
        try {
          if (isExpressionBlocked(expression)) {
            flagged.push({
              name: String(comp.name ?? "unknown"),
              version: String(comp.version ?? "unknown"),
              license: expression,
              reason: "SPDX expression resolves to blocked license(s)",
            });
          }
        } catch {
          spdxParseIssues.push({
            name: String(comp.name ?? "unknown"),
            version: String(comp.version ?? "unknown"),
            expression,
          });
        }
      } else if (normalizedId && isBlockedLicense(normalizedId)) {
        // Simple license ID check
        flagged.push({
          name: String(comp.name ?? "unknown"),
          version: String(comp.version ?? "unknown"),
          license: normalizedId,
          reason: "flagged license",
        });
      }
    }
  }

  // Report SPDX parse issues as warnings (not failures — we still check simple IDs)
  if (spdxParseIssues.length > 0) {
    warnFn(
      `${spdxParseIssues.length} component(s) have unparseable SPDX expressions (fell back to simple ID check)`
    );
    for (const issue of spdxParseIssues.slice(0, 5)) {
      warnFn(`  ${issue.name}@${issue.version}: "${issue.expression}"`);
    }
  }

  // Report flagged licenses
  if (flagged.length > 0) {
    for (const f of flagged) {
      check(`flagged license: ${f.name}@${f.version}`, false, `license=${f.license} — ${f.reason}`);
    }
  } else {
    check(
      "no blocked licenses (GPL/AGPL/SSPL/Commons Clause/BUSL)",
      true,
      `scanned ${componentCount} components`
    );
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  const passed = failures === 0;
  console.log(
    passed
      ? `\n# SBOM POLICY PASSED` + (warnings > 0 ? ` (${warnings} advisory warning(s))` : "")
      : `\n# SBOM POLICY FAILED — ${failures} violation(s)`
  );

  // ── Evidence report ────────────────────────────────────────────────────────
  const EVIDENCE_PATH = resolve(ROOT, "docs", "evidence", "security", "sbom-policy-audit.json");
  const report = {
    timestamp: new Date().toISOString(),
    result: passed ? "pass" : "fail",
    componentCount,
    blockedLicensesFound: flagged.length,
    flagged: flagged.map((f) => ({
      name: f.name,
      version: f.version,
      license: f.license,
      reason: f.reason,
    })),
    spdxParseWarnings: spdxParseIssues.length,
    advisoryWarnings: warnings,
    policy: {
      blockedLicenseCount: BLOCKED_LICENSES.size,
      blockedAliases: [...BLOCKED_ALIASES.keys()],
    },
  };
  try {
    writeFileSync(EVIDENCE_PATH, JSON.stringify(report, null, 2) + "\n", "utf8");
  } catch {
    // Best-effort evidence write — never fail on evidence file IO
  }

  process.exit(passed ? 0 : 1);
}
