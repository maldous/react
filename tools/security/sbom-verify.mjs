#!/usr/bin/env node
/**
 * sbom:verify — ADR-ACT-0247 / V1C-18.
 *
 * Verifies the SBOM baseline is present, valid, and fresh relative to the
 * package-lock.json that generated it. Staleness is advisory (warn, never fail)
 * — the verify gate only fails on missing or malformed SBOM.
 *
 * Usage: npm run sbom:verify
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");

const SBOM_PATH = resolve(ROOT, "docs", "evidence", "security", "sbom-baseline.json");
const LOCK_PATH = resolve(ROOT, "package-lock.json");

let failures = 0;
function check(label, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}` + (detail ? ` — ${detail}` : ""));
  if (!ok) failures++;
}

// ── SBOM exists ────────────────────────────────────────────────────────────
check("SBOM file exists", existsSync(SBOM_PATH), SBOM_PATH);
if (!existsSync(SBOM_PATH)) {
  console.log("\n# SBOM VERIFY FAILED — regenerate with: npm run sbom:generate");
  process.exit(1);
}

// ── SBOM is valid JSON ─────────────────────────────────────────────────────
let sbom;
try {
  sbom = JSON.parse(readFileSync(SBOM_PATH, "utf8"));
} catch {
  check("SBOM is valid JSON", false, "parse error");
  console.log("\n# SBOM VERIFY FAILED — SBOM is not valid JSON");
  process.exit(1);
}
check("SBOM is valid JSON", true);

// ── SBOM has expected structure ────────────────────────────────────────────
const hasComponents = !!(
  sbom &&
  (Array.isArray(sbom.components) || sbom.bomFormat === "CycloneDX")
);
check("SBOM has expected CycloneDX structure", hasComponents);
if (Array.isArray(sbom.components) && sbom.components.length === 0) {
  console.log(
    "WARN  SBOM has zero components — may be incomplete (regenerate with: npm run sbom:generate)"
  );
}

// ── SBOM freshness (advisory only) ─────────────────────────────────────────
if (existsSync(LOCK_PATH)) {
  const sbomTime = statSync(SBOM_PATH).mtimeMs;
  const lockTime = statSync(LOCK_PATH).mtimeMs;
  const hoursStale = (lockTime - sbomTime) / (1000 * 60 * 60);
  if (hoursStale > 0.5) {
    console.log(
      `WARN  SBOM may be stale — package-lock.json is ${hoursStale.toFixed(1)}h newer (advisory only; regenerate with: npm run sbom:generate)`
    );
  } else {
    check(
      "SBOM is fresh relative to package-lock.json",
      true,
      `${Math.abs(hoursStale).toFixed(1)}h delta`
    );
  }
} else {
  console.log("WARN  package-lock.json not found — cannot check freshness");
}

console.log(
  failures === 0 ? "\n# SBOM VERIFY PASSED" : `\n# SBOM VERIFY FAILED — ${failures} check(s) failed`
);
process.exit(failures === 0 ? 0 : 1);
