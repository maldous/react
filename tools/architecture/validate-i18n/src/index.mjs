#!/usr/bin/env node
/**
 * validate-i18n — ADR-ACT-0123
 *
 * Report-only: finds i18n keys used in source files that are missing from en-GB.json.
 * Promotes to a hard gate after ADR-ACT-0121 and ADR-ACT-0122 complete.
 *
 * Usage:
 *   node tools/architecture/validate-i18n/src/index.mjs [repo-root]
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const LOCALE_FILE = "packages/i18n-runtime/locales/en-GB.json";
const SCAN_DIRS = ["apps/react-enterprise-app/src", "apps/platform-api/src", "packages"];
// Match t("key") and serverT(messages, "key") patterns
const KEY_PATTERN = /(?:\bt|serverT)\s*\(\s*(?:[^,)]+,\s*)?["']([a-z][a-z0-9._-]*)["']/g;

function loadLocale(repoRoot) {
  const fp = path.join(repoRoot, LOCALE_FILE);
  if (!fs.existsSync(fp)) return null;
  try {
    return JSON.parse(fs.readFileSync(fp, "utf8"));
  } catch {
    return null;
  }
}

function flattenKeys(obj, prefix) {
  const keys = new Set();
  const p = prefix ?? "";
  for (const [k, v] of Object.entries(obj)) {
    const full = p ? `${p}.${k}` : k;
    if (typeof v === "string") {
      keys.add(full);
    } else if (typeof v === "object" && v !== null) {
      for (const nested of flattenKeys(v, full)) keys.add(nested);
    }
  }
  return keys;
}

function scanDir(dir, usedKeys) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "dist") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      scanDir(full, usedKeys);
      continue;
    }
    if (!/\.(ts|tsx|js|mjs)$/.test(entry.name)) continue;
    const src = fs.readFileSync(full, "utf8");
    for (const m of src.matchAll(KEY_PATTERN)) {
      usedKeys.add(m[1]);
    }
  }
}

function run(repoRoot) {
  const locale = loadLocale(repoRoot);
  if (!locale) {
    console.warn(
      `[validate-i18n] ${LOCALE_FILE} not found — skipping (install i18n-runtime first)`
    );
    return { status: "skipped", missing: [] };
  }

  const defined = flattenKeys(locale);
  const used = new Set();

  for (const dir of SCAN_DIRS) {
    scanDir(path.join(repoRoot, dir), used);
  }

  const missing = [...used].filter((k) => !defined.has(k));

  return { status: "complete", missing, definedCount: defined.size, usedCount: used.size };
}

const repoRoot = process.argv[2] ?? process.cwd();
const result = run(repoRoot);

if (result.status === "skipped") {
  process.exit(0);
}

if (result.missing.length > 0) {
  console.warn(`[validate-i18n] ${result.missing.length} used key(s) missing from ${LOCALE_FILE}:`);
  for (const k of result.missing) {
    console.warn(`  - ${k}`);
  }
  console.warn(
    "[validate-i18n] Report-only — will become a hard gate after ADR-ACT-0121 and ADR-ACT-0122."
  );
} else {
  console.log(
    `[validate-i18n] OK — all ${result.usedCount} used keys found in en-GB.json (${result.definedCount} defined)`
  );
}

// Always exit 0 — report-only mode
process.exit(0);
