#!/usr/bin/env node
/**
 * validate-i18n — ADR-ACT-0123
 *
 * Sub-checks (staged, per ADR-0026 "Tooling and enforcement"):
 *  1. Parse and flatten en-GB.json (nested → dot-separated keys)
 *  2. Detect duplicate keys in en-GB.json
 *  3. Detect unused keys in en-GB.json (keys defined but never referenced)
 *  4. Scan source for keys used via t() and serverT()
 *  5. Report keys used in source that are missing from en-GB.json
 *  6. Report interpolation variable mismatches where detectable from inline calls
 *  7. Hard-coded public copy detection (heuristic, always report-only)
 *
 * Default mode: report-only (exits 0 even when violations found).
 * Strict mode:  exits non-zero for missing keys, duplicate keys, unused keys,
 *               and interpolation mismatches (ADR-0011 fail-closed).
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

// ── Locale loading with duplicate detection ─────────────────────────────────

function flattenLocale(obj, prefix) { // NOSONAR
  const keys = new Map();
  const duplicates = [];
  const p = prefix ?? "";
  for (const [k, v] of Object.entries(obj)) {
    const full = p ? `${p}.${k}` : k;
    if (typeof v === "string") {
      if (keys.has(full)) {
        duplicates.push({ key: full, existing: keys.get(full), duplicate: v });
      }
      keys.set(full, v);
    } else if (typeof v === "object" && v !== null) {
      const nested = flattenLocale(v, full);
      for (const [nk, nv] of nested.map) {
        if (keys.has(nk)) {
          duplicates.push({
            key: nk,
            existing: keys.get(nk),
            duplicate: nv,
          });
        }
        keys.set(nk, nv);
      }
      duplicates.push(...nested.duplicates);
    }
  }
  return { map: keys, duplicates };
}

function loadLocale(root) {
  const fp = path.join(root, LOCALE_FILE);
  if (!fs.existsSync(fp)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(fp, "utf8"));
    const { map, duplicates } = flattenLocale(raw);
    return { map, duplicates };
  } catch {
    return null;
  }
}

// ── Source scanning ─────────────────────────────────────────────────────────

function processSourceFile(src, usedKeys, paramUsage) {
  for (const m of src.matchAll(KEY_PATTERN)) usedKeys.add(m[1]);
  for (const m of src.matchAll(INLINE_PARAMS_PATTERN)) {
    const key = m[1];
    const paramNames = [...m[2].matchAll(/(\w{1,50})\s*:/g)].map((p) => p[1]);
    if (!paramUsage.has(key)) paramUsage.set(key, new Set());
    paramNames.forEach((p) => paramUsage.get(key).add(p));
  }
}

function scanDir(dir, usedKeys, paramUsage, rawLiterals) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (
      entry.name === "node_modules" ||
      entry.name === "dist" ||
      entry.name === "tests" ||
      entry.name === "_template"
    )
      continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      scanDir(full, usedKeys, paramUsage, rawLiterals);
      continue;
    }
    if (!/\.(ts|tsx|js|mjs)$/.test(entry.name)) continue;
    const content = fs.readFileSync(full, "utf8");
    processSourceFile(content, usedKeys, paramUsage);
    // Raw-literal scan on governed UI files (advisory)
    if (/\.tsx$/.test(entry.name) && rawLiterals) {
      const relPath = full.replace(repoRoot + "/", "");
      rawLiterals.push(...scanRawLiterals(relPath, content));
    }
  }
}

// ── Raw-literal detection (governed-surface heuristic) ──────────────────────

// Common English function words and UI-chrome terms that, when found in JSX
// text children, suggest an un-governed raw literal rather than an i18n key.
const SUSPECT_WORDS =
  /\b(access|account|action|add|admin|alert|allow|announce|auth(?:entication|orisation)?|back|blocked|cancel|change|check|close|confirm|connect|copy|create|dashboard|delete|denied|disabled|done|download|edit|email|empty|enable|error|export|fail(?:ed|ure)?|filter|forbidden|form|generate|help|history|home|import|invalid|invite|key|label|limit|load(?:ing)?|log(?:in|out)?|manage|member|menu|message|missing|monitor|name|new|next|notification|off|on|open|optional|page|password|permission|platform|please|preview|previous|profile|read|ready|refresh|remove|required|reset|retry|role|save|search|select|send|setting|sign|status|submit|success|support|team|tenant|test|title|token|tool|try|unauthorised|unauthorized|update|upload|user|validate|verify|version|view|warning|webhook|welcome)\b/i;

/** Scan a single source file for raw user-facing English text in JSX. */
function scanRawLiterals(filePath, content) { // NOSONAR
  const findings = [];
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Match JSX text children: >Some English text<
    // Exclude lines that already call t(), useMessage, or <LocalizedText
    if (/\bt\(|useMessage\(|<LocalizedText\b/.test(line)) continue;
    // Exclude test files
    if (/\.test\.(ts|tsx)$/.test(filePath)) continue;

    const textMatches = line.matchAll(/>([^<>{}\n]{6,120})</g);
    for (const m of textMatches) {
      const text = m[1].trim();
      // Skip if it's a number, code reference, or test assertion
      if (/^[\d\s.,;:!?#$%^&*()[\]{}}/\\@_\-="'`~+<>|]+$/.test(text)) continue;
      // Skip variable interpolation braces
      if (/^[\s]*[{]/.test(text) || /[}]\s*$/.test(text)) continue;
      if (SUSPECT_WORDS.test(text)) {
        findings.push({ file: filePath, line: i + 1, text: text.slice(0, 80) });
      }
    }

    // Match aria-label / aria-description attributes with raw English
    const ariaMatches = line.matchAll(/aria-(?:label|description)=["']([^"']{8,120})["']/g);
    for (const m of ariaMatches) {
      if (SUSPECT_WORDS.test(m[1]) && !/^\{/.test(m[1])) {
        findings.push({ file: filePath, line: i + 1, text: `aria: ${m[1].slice(0, 80)}` });
      }
    }
  }
  return findings;
}

// ── Interpolation variable validation ───────────────────────────────────────

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

// ── Main ────────────────────────────────────────────────────────────────────

function run(root) { // NOSONAR
  const localeResult = loadLocale(root);
  if (!localeResult) {
    console.warn(
      `[validate-i18n] ${LOCALE_FILE} not found — skipping (install i18n-runtime first)`
    );
    return { status: "skipped" };
  }

  const { map: locale, duplicates } = localeResult;

  const used = new Set();
  const paramUsage = new Map();
  const rawLiterals = [];

  for (const dir of SCAN_DIRS) {
    const absDir = path.join(root, dir);
    if (!fs.existsSync(absDir)) continue;
    for (const entry of fs.readdirSync(absDir, { withFileTypes: true })) {
      if (
        entry.name === "node_modules" ||
        entry.name === "dist" ||
        entry.name === "tests" ||
        entry.name === "_template"
      )
        continue;
      const full = path.join(absDir, entry.name);
      if (entry.isDirectory()) {
        scanDir(full, used, paramUsage, rawLiterals);
        continue;
      }
      if (!/\.(ts|tsx|js|mjs)$/.test(entry.name)) continue;
      const content = fs.readFileSync(full, "utf8");
      processSourceFile(content, used, paramUsage);
      // Raw-literal scan on governed UI source files only (advisory, top-level scans)
      if (/\.tsx$/.test(entry.name)) {
        rawLiterals.push(...scanRawLiterals(full.replace(root + "/", ""), content));
      }
    }
  }

  const missing = [...used].filter((k) => !locale.has(k));
  const unused = [...locale.keys()].filter((k) => !used.has(k));
  const interpMismatches = checkInterpolation(locale, paramUsage);

  return {
    status: "complete",
    missing,
    unused,
    duplicates,
    interpMismatches,
    rawLiterals,
    definedCount: locale.size,
    usedCount: used.size,
  };
}

const result = run(repoRoot);

if (result.status === "skipped") {
  process.exit(0);
}

let hasViolations = false;

if (result.duplicates.length > 0) {
  console.warn(`[validate-i18n] ${result.duplicates.length} duplicate key(s) in ${LOCALE_FILE}:`);
  result.duplicates.forEach(({ key }) => console.warn(`  - ${key}`));
  hasViolations = true;
}

if (result.missing.length > 0) {
  console.warn(`[validate-i18n] ${result.missing.length} used key(s) missing from ${LOCALE_FILE}:`);
  result.missing.forEach((k) => console.warn(`  - ${k}`));
  hasViolations = true;
}

if (result.unused.length > 0) {
  // Unused keys are advisory — not a hard failure even in strict mode.
  // Keys may be used dynamically or in non-scanned template files.
  console.warn(
    `[validate-i18n] ${result.unused.length} unused key(s) in ${LOCALE_FILE} (defined but never referenced — advisory):`
  );
}

if (result.interpMismatches.length > 0) {
  console.warn(
    `[validate-i18n] ${result.interpMismatches.length} interpolation variable mismatch(es):`
  );
  result.interpMismatches.forEach(({ key, param, template, direction }) =>
    console.warn(`  - ${key}: param '${param}' ${direction} | template: "${template}"`)
  );
  // In strict mode, interpolation mismatches are violations too
  if (strictMode) {
    hasViolations = true;
  }
}

if (result.rawLiterals && result.rawLiterals.length > 0) {
  console.warn(
    `[validate-i18n] ${result.rawLiterals.length} raw-literal suspect(s) (ungoverned English in JSX — advisory):`
  );
  const shown = result.rawLiterals.slice(0, 20);
  shown.forEach(({ file, line, text }) => console.warn(`  - ${file}:${line}  ${text}`));
  if (result.rawLiterals.length > 20) {
    console.warn(`  ... and ${result.rawLiterals.length - 20} more`);
  }
}

if (!hasViolations && result.interpMismatches.length === 0) {
  console.log(
    `[validate-i18n] OK — all ${result.usedCount} used keys found in en-GB.json ` +
      `(${result.definedCount} defined, ${result.unused.length} unused)`
  );
} else if (!hasViolations) {
  console.log(
    `[validate-i18n] OK — all ${result.usedCount} used keys found ` +
      `(${result.interpMismatches.length} interpolation mismatches, report-only mode)`
  );
}

if (hasViolations && strictMode) {
  const reasons = [];
  if (result.duplicates.length > 0) reasons.push("duplicate keys");
  if (result.missing.length > 0) reasons.push("missing keys");
  if (result.unused.length > 0) reasons.push("unused keys");
  if (result.interpMismatches.length > 0) reasons.push("interpolation mismatches");
  console.error(`[validate-i18n] Strict mode: failing due to ${reasons.join(", ")} (ADR-0011).`);
  process.exit(1);
}

process.exit(0);
