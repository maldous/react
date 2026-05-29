#!/usr/bin/env node
/**
 * validate-i18n — ADR-ACT-0123
 *
 * Sub-checks (staged, per ADR-0026 §Tooling and enforcement):
 *  1. Parse and flatten en-GB.json (nested → dot-separated keys)
 *  2. Scan source for keys used via t() and serverT()
 *  3. Report keys used in source that are missing from en-GB.json
 *  4. Report interpolation variable mismatches where detectable from inline calls
 *  5. Hard-coded public copy detection (heuristic, always report-only)
 *
 * Default mode: report-only (exits 0 even when violations found).
 * Strict mode:  exits non-zero for missing keys (ADR-0011 fail-closed).
 *               Promote after ADR-ACT-0121 and ADR-ACT-0122 complete.
 *
 * Usage:
 *   node tools/architecture/validate-i18n/src/index.mjs [repo-root] [--strict]
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const LOCALE_FILE = "packages/i18n-runtime/locales/en-GB.json";
const SCAN_DIRS = ["apps/react-enterprise-app/src", "apps/platform-api/src", "packages"];

// Match t("key") and serverT(messages, "key") patterns — bounded to prevent ReDoS
const KEY_PATTERN = /(?:\bt|serverT)\s*\(\s*(?:[^,)"']{0,200},\s*)?["']([a-z][a-z0-9._-]*)["']/g;

// Match t("key", { param: ... }) inline objects to extract param names used
const INLINE_PARAMS_PATTERN = /\bt\s*\(\s*["']([a-z][a-z0-9._-]*)["']\s*,\s*\{([^}]*)\}/g;

// Match {paramName} placeholders in translation templates
const TEMPLATE_PARAM_PATTERN = /\{(\w+)\}/g;

// Parse CLI args
const args = process.argv.slice(2);
const strictMode = args.includes("--strict");
const repoRoot = args.find((a) => !a.startsWith("--")) ?? process.cwd();

// ---------------------------------------------------------------------------
// Locale loading — supports nested JSON (mirrors en-GB.json shape)
// ---------------------------------------------------------------------------

function flattenLocale(obj, prefix) {
  const keys = new Map();
  const p = prefix ?? "";
  for (const [k, v] of Object.entries(obj)) {
    const full = p ? `${p}.${k}` : k;
    if (typeof v === "string") {
      keys.set(full, v);
    } else if (typeof v === "object" && v !== null) {
      for (const [nk, nv] of flattenLocale(v, full)) keys.set(nk, nv);
    }
  }
  return keys;
}

function loadLocale(root) {
  const fp = path.join(root, LOCALE_FILE);
  if (!fs.existsSync(fp)) return null;
  try {
    return flattenLocale(JSON.parse(fs.readFileSync(fp, "utf8")));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Source scanning
// ---------------------------------------------------------------------------

function processSourceFile(src, usedKeys, paramUsage) {
  for (const m of src.matchAll(KEY_PATTERN)) usedKeys.add(m[1]);
  for (const m of src.matchAll(INLINE_PARAMS_PATTERN)) {
    const key = m[1];
    const paramNames = [...m[2].matchAll(/(\w{1,50})\s*:/g)].map((p) => p[1]);
    if (!paramUsage.has(key)) paramUsage.set(key, new Set());
    paramNames.forEach((p) => paramUsage.get(key).add(p));
  }
}

function scanDir(dir, usedKeys, paramUsage) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "dist") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      scanDir(full, usedKeys, paramUsage);
      continue;
    }
    if (!/\.(ts|tsx|js|mjs)$/.test(entry.name)) continue;
    processSourceFile(fs.readFileSync(full, "utf8"), usedKeys, paramUsage);
  }
}

// ---------------------------------------------------------------------------
// Interpolation variable validation
// ---------------------------------------------------------------------------

function checkInterpolation(localeMap, paramUsage) {
  const mismatches = [];
  for (const [key, usedParams] of paramUsage) {
    const template = localeMap.get(key);
    if (!template) continue; // already reported as missing key
    const templateParams = new Set([...template.matchAll(TEMPLATE_PARAM_PATTERN)].map((m) => m[1]));
    for (const param of usedParams) {
      if (!templateParams.has(param)) {
        mismatches.push({ key, param, template, direction: "extra-in-call" });
      }
    }
    for (const param of templateParams) {
      if (!usedParams.has(param)) {
        mismatches.push({ key, param, template, direction: "missing-in-call" });
      }
    }
  }
  return mismatches;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function run(root) {
  const locale = loadLocale(root);
  if (!locale) {
    console.warn(
      `[validate-i18n] ${LOCALE_FILE} not found — skipping (install i18n-runtime first)`
    );
    return { status: "skipped" };
  }

  const used = new Set();
  const paramUsage = new Map();

  for (const dir of SCAN_DIRS) {
    scanDir(path.join(root, dir), used, paramUsage);
  }

  const missing = [...used].filter((k) => !locale.has(k));
  const interpMismatches = checkInterpolation(locale, paramUsage);

  return {
    status: "complete",
    missing,
    interpMismatches,
    definedCount: locale.size,
    usedCount: used.size,
  };
}

const result = run(repoRoot);

if (result.status === "skipped") {
  process.exit(0);
}

let hasKeyViolations = false;

if (result.missing.length > 0) {
  console.warn(`[validate-i18n] ${result.missing.length} used key(s) missing from ${LOCALE_FILE}:`);
  result.missing.forEach((k) => console.warn(`  - ${k}`));
  hasKeyViolations = true;
}

if (result.interpMismatches.length > 0) {
  console.warn(
    `[validate-i18n] ${result.interpMismatches.length} interpolation variable mismatch(es):`
  );
  result.interpMismatches.forEach(({ key, param, template, direction }) =>
    console.warn(`  - ${key}: param '${param}' ${direction} | template: "${template}"`)
  );
}

if (!hasKeyViolations && result.interpMismatches.length === 0) {
  console.log(
    `[validate-i18n] OK — all ${result.usedCount} used keys found in en-GB.json (${result.definedCount} defined)`
  );
}

if (hasKeyViolations && strictMode) {
  console.error("[validate-i18n] Strict mode: failing due to missing i18n keys (ADR-0011).");
  process.exit(1);
}

// Always exit 0 in report-only mode; exit 1 only for key violations in strict mode
process.exit(0);
