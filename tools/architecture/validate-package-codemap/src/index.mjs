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

// Linear-time patterns (no adjacent \s+/\s* around a quantified group → no ReDoS):
// lines are trimmed first so a single literal space is sufficient.
const SECTION_RE = /^## ([^()]+) \((\d+)\)$/;
const TOTAL_RE = /^## Total: (\d+) packages/;
const DISTRIBUTION_RE = /^\*\*Lifecycle Distribution\*\*:(.*)$/;
const ROW_RE = /^\| (@platform\/[a-z0-9-]+) +\| ([a-z]+) +\|/;

const isLowerAlpha = (s) => s.length > 0 && [...s].every((c) => c >= "a" && c <= "z");

// Parse "33 active, 9 experimental, 9 deprecated (…)" into {active:33,…} using
// pure string ops (no regex → no ReDoS surface) — each comma-part's first two
// space-separated tokens are the count and the stage.
function parseDistribution(text) {
  const out = {};
  for (const part of text.split(",")) {
    const [countToken, stageToken] = part.trim().split(" ");
    const count = Number(countToken);
    if (Number.isInteger(count) && stageToken && isLowerAlpha(stageToken)) {
      out[stageToken] = count;
    }
  }
  return out;
}

// Parse the codemap into { sections:[{name,declaredCount,rows:[{name,lifecycle}]}], total, distribution }.
export function parseCodemap(markdown) {
  const sections = [];
  let current = null;
  let total = null;
  let distribution = {};
  for (const raw of markdown.split("\n")) {
    const line = raw.trim();
    const sec = SECTION_RE.exec(line);
    if (sec) {
      current = { name: sec[1].trim(), declaredCount: Number(sec[2]), rows: [] };
      sections.push(current);
      continue;
    }
    const totalMatch = TOTAL_RE.exec(line);
    if (totalMatch) {
      total = Number(totalMatch[1]);
      current = null;
      continue;
    }
    const distMatch = DISTRIBUTION_RE.exec(line);
    if (distMatch) {
      distribution = parseDistribution(distMatch[1]);
      continue;
    }
    const row = ROW_RE.exec(line);
    if (row && current) current.rows.push({ name: row[1], lifecycle: row[2] });
  }
  return { sections, total, distribution };
}

// --- focused checks (kept small so checkCodemap stays low-complexity) ---

function collectRows(sections, errors) {
  const seen = new Map();
  const rows = [];
  for (const section of sections) {
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
  return { seen, rows };
}

function checkMembership(seen, real, errors) {
  for (const name of real) {
    if (!seen.has(name)) errors.push(`missing package (in repo but not in codemap): ${name}`);
  }
  for (const name of seen.keys()) {
    if (!real.has(name)) errors.push(`unknown package (in codemap but not in repo): ${name}`);
  }
}

function checkLifecycleValues(rows, packages, errors) {
  for (const r of rows) {
    const pkg = packages.get(r.name);
    if (pkg && pkg.stage !== r.lifecycle) {
      errors.push(`lifecycle mismatch for ${r.name}: codemap=${r.lifecycle} metadata=${pkg.stage}`);
    }
  }
}

function checkTotal(total, rowCount, realSize, errors) {
  if (total !== rowCount) errors.push(`headline Total (${total}) != ${rowCount} listed rows`);
  if (total !== realSize) errors.push(`headline Total (${total}) != ${realSize} real packages`);
}

function checkDistribution(distribution, packages, errors) {
  const realDist = {};
  for (const p of packages.values()) realDist[p.stage] = (realDist[p.stage] || 0) + 1;
  for (const [stage, count] of Object.entries(distribution)) {
    if ((realDist[stage] || 0) !== count) {
      errors.push(`lifecycle distribution ${stage}=${count} != actual ${realDist[stage] || 0}`);
    }
  }
  for (const [stage, count] of Object.entries(realDist)) {
    if (distribution[stage] === undefined) {
      errors.push(`lifecycle distribution missing stage ${stage} (actual ${count})`);
    }
  }
}

// Cross-check the parsed codemap against `packages` (Map<name,{stage}>). Returns
// an array of human-readable error strings; empty when consistent.
export function checkCodemap(parsed, packages) {
  const errors = [];
  const { seen, rows } = collectRows(parsed.sections, errors);
  const real = new Set(packages.keys());
  checkMembership(seen, real, errors);
  checkLifecycleValues(rows, packages, errors);
  checkTotal(parsed.total, rows.length, real.size, errors);
  checkDistribution(parsed.distribution, packages, errors);
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
