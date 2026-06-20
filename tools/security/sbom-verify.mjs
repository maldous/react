#!/usr/bin/env node
/**
 * sbom:verify — ADR-ACT-0247 / V1C-18.
 *
 * Verifies the SBOM baseline is present, valid, and semantically fresh
 * relative to the package-lock.json that generated it.
 *
 * Freshness is determined by SHA-256 hash comparison, not mtime.
 *   - In authoritative mode (CI=true or AUTHORITATIVE_SCAN=true): hash mismatch → exit 1
 *   - Otherwise: hash mismatch → warn (advisory only)
 *
 * Verifies CycloneDX structure, tool version, schema version, component
 * identities, dependency graph, and license data completeness.
 *
 * Usage: npm run sbom:verify
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");

const SBOM_PATH = resolve(ROOT, "docs", "evidence", "security", "sbom-baseline.json");
const LOCK_PATH = resolve(ROOT, "package-lock.json");
const LOCKHASH_PATH = resolve(ROOT, "docs", "evidence", "security", "sbom-baseline.lockhash");

const AUTHORITATIVE = process.env.CI === "true" || process.env.AUTHORITATIVE_SCAN === "true";

let failures = 0;

function check(label, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}` + (detail ? ` — ${detail}` : ""));
  if (!ok) failures++;
}

function warn(msg) {
  console.log(`WARN  ${msg}`);
}

function fatal(label, detail) {
  console.log(`FAIL  ${label} — ${detail}`);
  console.error(`\n# SBOM VERIFY FAILED — ${detail}\n`);
  process.exit(1);
}

// ── SBOM exists ────────────────────────────────────────────────────────────
if (!existsSync(SBOM_PATH)) {
  fatal("SBOM file exists", `not found at ${SBOM_PATH} — regenerate with: npm run sbom:generate`);
}
check("SBOM file exists", true, SBOM_PATH);

// ── SBOM is valid JSON ─────────────────────────────────────────────────────
let sbom;
try {
  sbom = JSON.parse(readFileSync(SBOM_PATH, "utf8"));
} catch {
  fatal("SBOM is valid JSON", "parse error — SBOM is not valid JSON");
}
check("SBOM is valid JSON", true);

// ── Normalize volatile fields for structural comparison ────────────────────
// Fields that change on every generation but don't represent semantic drift.
// We operate on a copy to avoid mutating the loaded object in confusing ways.
const normalized = JSON.parse(JSON.stringify(sbom));
normalized.serialNumber = "<volatile>";
if (normalized.metadata) {
  normalized.metadata.timestamp = "<volatile>";
}

// ── CycloneDX structure validation ─────────────────────────────────────────
const isCycloneDX =
  normalized.bomFormat === "CycloneDX" &&
  typeof normalized.specVersion === "string" &&
  typeof normalized.version === "number";
check("SBOM is CycloneDX format", isCycloneDX);

const hasSpecVersion = !!normalized.specVersion;
check(
  "SBOM has specVersion",
  hasSpecVersion,
  hasSpecVersion ? `v${normalized.specVersion}` : "missing"
);

const hasMetadata = !!(normalized.metadata && typeof normalized.metadata === "object");
check("SBOM has metadata block", hasMetadata);

// ── Tool version tracking ──────────────────────────────────────────────────
const tools = normalized.metadata?.tools?.components ?? [];
const cyclonedxTool = tools.find((t) => t?.group === "@cyclonedx" && t?.name === "cyclonedx-npm");
check(
  "SBOM records cyclonedx-npm tool version",
  !!cyclonedxTool,
  cyclonedxTool?.version ?? "not found"
);

const npmTool = tools.find((t) => t?.name === "npm");
check("SBOM records npm tool version", !!npmTool, npmTool?.version ?? "not found");

// ── Root component identity ────────────────────────────────────────────────
const root = normalized.metadata?.component;
check("SBOM has root component", !!root);
if (root) {
  check("Root component has name", !!root.name, root.name);
  check("Root component has version", !!root.version, root.version);
  check("Root component has purl", !!root.purl, root.purl);
  check("Root component has bom-ref", !!root["bom-ref"], root["bom-ref"]);
}

// ── Component identities ───────────────────────────────────────────────────
const components = Array.isArray(normalized.components) ? normalized.components : [];

function flattenComponents(comps, out = []) {
  for (const c of comps) {
    out.push(c);
    if (Array.isArray(c.components)) {
      flattenComponents(c.components, out);
    }
  }
  return out;
}

const allComponents = flattenComponents(components);
const uniqueBomRefs = new Set(allComponents.map((c) => c["bom-ref"]).filter(Boolean));
check("SBOM has components", allComponents.length > 0, `n=${allComponents.length}`);
check(
  "All components have bom-ref",
  allComponents.every((c) => !!c["bom-ref"]),
  `${allComponents.filter((c) => !c["bom-ref"]).length} missing`
);
check(
  "All bom-ref values are unique",
  uniqueBomRefs.size === allComponents.length,
  `${uniqueBomRefs.size} unique / ${allComponents.length} total`
);

// ── License data completeness ──────────────────────────────────────────────
const componentsWithoutLicenses = allComponents.filter(
  (c) => !c.licenses || (Array.isArray(c.licenses) && c.licenses.length === 0)
);
const licenseCoverage =
  allComponents.length > 0
    ? (
        ((allComponents.length - componentsWithoutLicenses.length) / allComponents.length) *
        100
      ).toFixed(1)
    : "0";
// Require ≥95% license coverage; warn below 100%
const hasGoodLicenseCoverage =
  componentsWithoutLicenses.length === 0 ||
  (allComponents.length > 0 && componentsWithoutLicenses.length / allComponents.length <= 0.05);
if (componentsWithoutLicenses.length === 0) {
  check("All components declare licenses", true, `${allComponents.length} components checked`);
} else if (hasGoodLicenseCoverage) {
  warn(
    `${componentsWithoutLicenses.length} of ${allComponents.length} components missing licenses (${licenseCoverage}% coverage — above 95% threshold)`
  );
} else {
  check(
    "License coverage ≥95%",
    false,
    `${componentsWithoutLicenses.length} of ${allComponents.length} components missing licenses (${licenseCoverage}% coverage — below 95% threshold; first: ${componentsWithoutLicenses[0]?.name ?? "unknown"})`
  );
}

// ── Dependency graph ───────────────────────────────────────────────────────
const hasDependencies = !!(normalized.dependencies && Array.isArray(normalized.dependencies));
check("SBOM has dependency graph", hasDependencies);
if (hasDependencies) {
  const depCount = normalized.dependencies.length;
  check("Dependency graph has entries", depCount > 0, `n=${depCount}`);
}

// ── SHA-256 semantic freshness ─────────────────────────────────────────────
if (!existsSync(LOCK_PATH)) {
  warn("package-lock.json not found — cannot check freshness");
} else {
  const currentHash = createHash("sha256").update(readFileSync(LOCK_PATH, "utf8")).digest("hex");

  let storedHash = null;
  if (existsSync(LOCKHASH_PATH)) {
    storedHash = readFileSync(LOCKHASH_PATH, "utf8").trim();
  }

  if (!storedHash) {
    // No stored hash — in authoritative mode this is a failure;
    // in non-authoritative mode, write the baseline hash and warn.
    if (AUTHORITATIVE) {
      fatal(
        "SBOM lockfile hash baseline exists",
        `no hash file at ${LOCKHASH_PATH} — establish baseline with: make sbom`
      );
    }
    writeFileSync(LOCKHASH_PATH, `${currentHash}\n`, "utf8");
    warn(
      `No lockfile hash on record — recorded current hash ${currentHash.slice(0, 16)}... as baseline`
    );
  } else if (storedHash !== currentHash) {
    const label = "SBOM is semantically fresh (lockfile hash match)";
    const detail = `stored=${storedHash.slice(0, 16)}... current=${currentHash.slice(0, 16)}... — regenerate with: npm run sbom:generate`;
    if (AUTHORITATIVE) {
      fatal(label, detail);
    } else {
      check(label, false, detail);
    }
  } else {
    check(
      "SBOM is semantically fresh (lockfile hash match)",
      true,
      `${storedHash.slice(0, 16)}...`
    );
  }
}

// ── summary ────────────────────────────────────────────────────────────────
const modeLabel = AUTHORITATIVE ? " (authoritative)" : "";
const passed = failures === 0;
console.log(
  passed
    ? `\n# SBOM VERIFY PASSED${modeLabel}`
    : `\n# SBOM VERIFY FAILED${modeLabel} — ${failures} check(s) failed`
);

// ── Evidence report ────────────────────────────────────────────────────────
const EVIDENCE_PATH = resolve(ROOT, "docs", "evidence", "security", "sbom-verify-report.json");
const report = {
  timestamp: new Date().toISOString(),
  result: passed ? "pass" : "fail",
  mode: AUTHORITATIVE ? "authoritative" : "advisory",
  sbom: {
    specVersion: normalized.specVersion ?? "unknown",
    componentCount: allComponents.length,
    uniqueBomRefs: uniqueBomRefs.size,
    dependencyCount: hasDependencies ? normalized.dependencies.length : 0,
    licenseCoverage: `${licenseCoverage}%`,
    toolVersion: cyclonedxTool?.version ?? "unknown",
  },
  lockfileHash: existsSync(LOCKHASH_PATH)
    ? readFileSync(LOCKHASH_PATH, "utf8").trim().slice(0, 16) + "..."
    : "not recorded",
  failures,
};
try {
  writeFileSync(EVIDENCE_PATH, JSON.stringify(report, null, 2) + "\n", "utf8");
} catch {
  // Best-effort evidence write — never fail on evidence file IO
}

process.exit(passed ? 0 : 1);
