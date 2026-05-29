#!/usr/bin/env node
/**
 * Normalizes coverage/lcov.info after `npm run test:coverage`.
 *
 * Problem: the self-evidence architecture tests copy tools to a temp directory
 * and import them there, so Node's coverage reporter emits SF entries with
 * paths like "../../../../tmp/architecture-self-evidence-XXXXX/tools/architecture/..."
 * that SonarQube cannot resolve back to the repo.
 *
 * Fix: if a temp-path SF entry maps to a real repo file AND no real-path entry
 * already exists for that file, remap the SF line to the repo-relative path.
 * Duplicate temp entries (when a real-path entry already exists) are dropped.
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const LCOV_PATH = "coverage/lcov.info";
const TOOLS_MARKER = "tools/architecture/";

const repoRoot = process.cwd();

if (!fs.existsSync(LCOV_PATH)) {
  console.error(`normalize-lcov: ${LCOV_PATH} not found — run test:coverage first`);
  process.exit(1);
}

const content = fs.readFileSync(LCOV_PATH, "utf8");
const records = content.split("end_of_record\n");

// First pass: find all canonical paths that already have a real-path entry.
const hasRealEntry = new Set();
for (const rec of records) {
  const m = rec.match(/^SF:(.+)$/m);
  if (!m) continue;
  const p = m[1];
  if (!p.includes("/tmp/") && !p.includes("architecture-self-evidence")) {
    hasRealEntry.add(p);
  }
}

// Second pass: build output, remapping temp entries that have no real counterpart.
const addedFromTemp = new Set();
const out = [];

for (const rec of records) {
  if (!rec.trim()) continue;
  const m = rec.match(/^SF:(.+)$/m);
  if (!m) {
    out.push(rec + "end_of_record\n");
    continue;
  }

  const p = m[1];
  const isTemp = p.includes("/tmp/") || p.includes("architecture-self-evidence");

  if (!isTemp) {
    out.push(rec + "end_of_record\n");
    continue;
  }

  // Extract the repo-relative path from the temp path.
  const idx = p.indexOf(TOOLS_MARKER);
  if (idx === -1) continue;
  const realPath = p.slice(idx);

  if (hasRealEntry.has(realPath) || addedFromTemp.has(realPath)) continue;
  if (!fs.existsSync(path.join(repoRoot, realPath))) continue;

  addedFromTemp.add(realPath);
  out.push(rec.replace(/^SF:.+$/m, `SF:${realPath}`) + "end_of_record\n");
}

fs.writeFileSync(LCOV_PATH, out.join(""), "utf8");

const beforeCount = (content.match(/^SF:/gm) ?? []).length;
const afterCount = (out.join("").match(/^SF:/gm) ?? []).length;
const remapped = addedFromTemp.size;
const dropped = beforeCount - afterCount - remapped;

console.log(
  `normalize-lcov: ${beforeCount} → ${afterCount} SF entries` +
    ` (remapped ${remapped} temp paths, dropped ${dropped} unresolvable)`
);
