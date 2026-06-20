#!/usr/bin/env node
/**
 * sbom:policy — ADR-ACT-0247 / V1C-18.
 *
 * Checks the SBOM against the project security/license policy:
 *   - Flagged licenses (GPL/AGPL/SSPL/Commons Clause)
 *   - Component count reasonableness (warn if empty or implausibly small)
 *
 * This is a fast local gate. A full vulnerability scan requires OSV / npm audit.
 *
 * Usage: npm run sbom:policy
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");

const SBOM_PATH = resolve(ROOT, "docs", "evidence", "security", "sbom-baseline.json");

// ── Flagged licenses (aligned with license:policy gate) ────────────────────
const FLAGGED_LICENSES = new Set([
  "GPL-2.0",
  "GPL-2.0-only",
  "GPL-2.0-or-later",
  "GPL-3.0",
  "GPL-3.0-only",
  "GPL-3.0-or-later",
  "AGPL-3.0",
  "AGPL-3.0-only",
  "AGPL-3.0-or-later",
  "SSPL-1.0",
  "Commons Clause",
]);

let failures = 0;
let warnings = 0;
function check(label, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}` + (detail ? ` — ${detail}` : ""));
  if (!ok) failures++;
}
function warn(msg) {
  console.log(`WARN  ${msg}`);
  warnings++;
}

// ── Load SBOM ──────────────────────────────────────────────────────────────
let sbom;
try {
  sbom = JSON.parse(readFileSync(SBOM_PATH, "utf8"));
  check("SBOM loaded successfully", true);
} catch {
  check(
    "SBOM loaded successfully",
    false,
    `${SBOM_PATH} not found or invalid — generate with: npm run sbom:generate`
  );
  process.exit(1);
}

// ── Component count ────────────────────────────────────────────────────────
const components = Array.isArray(sbom.components) ? sbom.components : [];
const componentCount = components.length;
check("SBOM contains components", componentCount > 0, `n=${componentCount}`);
if (componentCount > 0 && componentCount < 20) {
  warn(
    `SBOM contains only ${componentCount} components — may be incomplete (check sbom:generate output)`
  );
}

// ── License audit ──────────────────────────────────────────────────────────
const flagged = [];
for (const comp of components) {
  const licenses = comp.licenses ?? [];
  for (const lic of Array.isArray(licenses) ? licenses : [licenses]) {
    const id =
      typeof lic === "object" && lic ? (lic.license?.id ?? lic.id ?? "") : String(lic ?? "");
    if (FLAGGED_LICENSES.has(id)) {
      flagged.push({
        name: String(comp.name ?? "unknown"),
        version: String(comp.version ?? "unknown"),
        license: id,
      });
    }
  }
}

if (flagged.length > 0) {
  for (const f of flagged) {
    check(`flagged license: ${f.name}@${f.version}`, false, `license=${f.license}`);
  }
} else {
  check(
    "no flagged licenses (GPL/AGPL/SSPL/Commons)",
    true,
    `scanned ${componentCount} components`
  );
}

console.log(
  failures === 0
    ? `\n# SBOM POLICY PASSED` + (warnings > 0 ? ` (${warnings} advisory warning(s))` : "")
    : `\n# SBOM POLICY FAILED — ${failures} violation(s)`
);
process.exit(failures === 0 ? 0 : 1);
