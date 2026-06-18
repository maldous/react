#!/usr/bin/env node
// Validates docs/CODEMAPS/packages.md against live package metadata so the
// hand-maintained codemap cannot drift (ADR-0006 / ADR-ACT-0289 / ADR-0009).
// Pure functions are exported for unit testing; the CLI fails closed (exit 1)
// when the committed codemap is stale or inconsistent.
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { findRepoRoot as sharedFindRepoRoot } from "../../_shared/repo-root.mjs";

const findRepoRoot = (startDir) => sharedFindRepoRoot(startDir, "docs/CODEMAPS/packages.md");

// Parse the codemap into { sections:[{name,declaredCount,rows:[{name,lifecycle}]}], total, distribution }.
export function parseCodemap(markdown) {
  const sections = [];
  let current = null;
  let total = null;
  const distribution = {};
  for (const line of markdown.split("\n")) {
    const sec = line.match(/^##\s+(.+?)\s+\((\d+)\)\s*$/);
    if (sec) {
      current = { name: sec[1], declaredCount: Number(sec[2]), rows: [] };
      sections.push(current);
      continue;
    }
    const totalMatch = line.match(/^##\s+Total:\s*(\d+)\s+packages/);
    if (totalMatch) {
      total = Number(totalMatch[1]);
      current = null;
      continue;
    }
    const distMatch = line.match(/\*\*Lifecycle Distribution\*\*:\s*(.+)/);
    if (distMatch) {
      for (const m of distMatch[1].matchAll(/(\d+)\s+([a-z]+)/g)) distribution[m[2]] = Number(m[1]);
      continue;
    }
    const row = line.match(/^\|\s*(@platform\/[a-z0-9-]+)\s*\|\s*([a-z]+)\s*\|/);
    if (row && current) current.rows.push({ name: row[1], lifecycle: row[2] });
  }
  return { sections, total, distribution };
}

// Cross-check the parsed codemap against `packages` (Map<name,{stage}>). Returns
// an array of human-readable error strings; empty when consistent.
export function checkCodemap(parsed, packages) {
  const errors = [];
  const seen = new Map();
  const rows = [];
  for (const section of parsed.sections) {
    if (section.rows.length !== section.declaredCount) {
      errors.push(
        `section "${section.name}": header count ${section.declaredCount} != ${section.rows.length} listed rows`
      );
    }
    for (const r of section.rows) {
      rows.push(r);
      if (seen.has(r.name)) errors.push(`duplicate package row: ${r.name}`);
      else seen.set(r.name, r);
    }
  }

  const real = new Set(packages.keys());
  for (const name of real) {
    if (!seen.has(name)) errors.push(`missing package (in repo but not in codemap): ${name}`);
  }
  for (const name of seen.keys()) {
    if (!real.has(name)) errors.push(`unknown package (in codemap but not in repo): ${name}`);
  }
  for (const r of rows) {
    const pkg = packages.get(r.name);
    if (pkg && pkg.stage !== r.lifecycle) {
      errors.push(`lifecycle mismatch for ${r.name}: codemap=${r.lifecycle} metadata=${pkg.stage}`);
    }
  }

  if (parsed.total !== rows.length) {
    errors.push(`headline Total (${parsed.total}) != ${rows.length} listed rows`);
  }
  if (parsed.total !== real.size) {
    errors.push(`headline Total (${parsed.total}) != ${real.size} real packages`);
  }

  const realDist = {};
  for (const p of packages.values()) realDist[p.stage] = (realDist[p.stage] || 0) + 1;
  for (const [stage, count] of Object.entries(parsed.distribution)) {
    if ((realDist[stage] || 0) !== count) {
      errors.push(`lifecycle distribution ${stage}=${count} != actual ${realDist[stage] || 0}`);
    }
  }
  for (const [stage, count] of Object.entries(realDist)) {
    if (parsed.distribution[stage] === undefined) {
      errors.push(`lifecycle distribution missing stage ${stage} (actual ${count})`);
    }
  }
  return errors;
}

export function loadPackages(repoRoot) {
  const dir = path.join(repoRoot, "packages");
  const map = new Map();
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const pj = path.join(dir, entry.name, "package.json");
    if (!fs.existsSync(pj)) continue;
    const d = JSON.parse(fs.readFileSync(pj, "utf8"));
    if (d.name && d.architecture?.lifecycle?.stage) {
      map.set(d.name, { stage: d.architecture.lifecycle.stage });
    }
  }
  return map;
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  const repoRoot = findRepoRoot(process.cwd());
  const md = fs.readFileSync(path.join(repoRoot, "docs", "CODEMAPS", "packages.md"), "utf8");
  const errors = checkCodemap(parseCodemap(md), loadPackages(repoRoot));
  if (errors.length > 0) {
    console.error("docs/CODEMAPS/packages.md is inconsistent:\n- " + errors.join("\n- "));
    process.exit(1);
  }
  console.log("package codemap consistent with package metadata");
}
