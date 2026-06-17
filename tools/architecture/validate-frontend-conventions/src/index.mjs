#!/usr/bin/env node
// Frontend convention validator (ADR-ACT-0203). Guards the canonical UI feature
// baseline against the most likely future drift:
//
//   1. no-feature-main      — feature pages/components must not render the
//                             <main id="main-content"> landmark; the AppShell
//                             _authenticated layout owns the single main.
//   2. no-inline-graphql    — feature code must not embed GraphQL operation
//                             strings; operations are authored as .graphql
//                             documents and consumed as generated TypedDocumentNode.
//   3. no-raw-graphql-fetch — SPA app code must not fetch('/api/graphql')
//                             directly; GraphQL transport goes through
//                             @platform/graphql-browser-client only.
//
// Standalone (mirrors validate-openapi-drift): run via `npm run frontend:conventions`
// and exercised by tests in test:architecture. Exits non-zero on any violation.
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { findRepoRoot as sharedFindRepoRoot } from "../../_shared/repo-root.mjs";

const APP_REL = "apps/react-enterprise-app/src";
const FEATURES_SUBDIR = "features";

export function findRepoRoot(startDir) {
  return sharedFindRepoRoot(startDir, "docs/architecture/import-boundary-rules.json");
}

const isTestFile = (rel) => /(?:^|\/)__tests__\//.test(rel) || /\.test\.[tj]sx?$/.test(rel);
const isTemplate = (rel) => rel.includes("/features/_template/");
const isMsw = (rel) => rel.includes("/msw/");

const MAIN_LANDMARK = /id\s*=\s*["']main-content["']/;
const GRAPHQL_OP = /\b(?:query|mutation|subscription)\s+[A-Za-z_]\w*\s*[({]/;
const GRAPHQL_FRAGMENT = /\bfragment\s+[A-Za-z_]\w*\s+on\s+[A-Za-z_]/;
const GQL_TAG = /\bgql`/;
const RAW_GRAPHQL_FETCH = /fetch\(\s*[`"'][^`"']*\/api\/graphql/;

/** Backtick template-literal bodies in the source (naive: no nested backticks). */
function templateLiterals(content) {
  return content.match(/`[^`]*`/gs) ?? [];
}

/**
 * Detect convention violations in one file. `rel` is the repo-relative path.
 * Pure + exported so it can be unit-tested without touching the filesystem.
 */
export function detectViolationsInFile(rel, content) {
  const violations = [];
  const inFeatures = rel.includes(`/${FEATURES_SUBDIR}/`) && !isTemplate(rel);

  // 1. main landmark in feature code
  if (inFeatures && !isTestFile(rel) && MAIN_LANDMARK.test(content)) {
    violations.push({
      rule: "no-feature-main",
      file: rel,
      message:
        'feature code must not render <main id="main-content"> — the AppShell layout owns it',
    });
  }

  // 2. inline GraphQL operation strings in feature code
  if (inFeatures && !isTestFile(rel)) {
    const hasInlineOp =
      GQL_TAG.test(content) ||
      templateLiterals(content).some((tpl) => GRAPHQL_OP.test(tpl) || GRAPHQL_FRAGMENT.test(tpl));
    if (hasInlineOp) {
      violations.push({
        rule: "no-inline-graphql",
        file: rel,
        message:
          "inline GraphQL operation string — author operations in packages/contracts-graphql/src/operations/*.graphql and use the generated TypedDocumentNode",
      });
    }
  }

  // 3. raw /api/graphql fetch in SPA app code (tests + MSW are exempt)
  if (!isTestFile(rel) && !isMsw(rel) && !isTemplate(rel) && RAW_GRAPHQL_FETCH.test(content)) {
    violations.push({
      rule: "no-raw-graphql-fetch",
      file: rel,
      message:
        "raw fetch('/api/graphql') — use graphqlRequest from @platform/graphql-browser-client",
    });
  }

  return violations;
}

function walk(dir, repoRoot, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (["node_modules", "dist", "coverage"].includes(entry.name)) continue;
      walk(full, repoRoot, out);
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      out.push(full);
    }
  }
}

export function scanRepo(repoRoot) {
  const base = path.join(repoRoot, APP_REL);
  const files = [];
  walk(base, repoRoot, files);
  const violations = [];
  for (const file of files) {
    const rel = path.relative(repoRoot, file).split(path.sep).join("/");
    violations.push(...detectViolationsInFile(rel, fs.readFileSync(file, "utf8")));
  }
  return violations;
}

// CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  const repoRoot = findRepoRoot(process.cwd());
  const violations = scanRepo(repoRoot);
  if (violations.length === 0) {
    console.log(
      "[validate-frontend-conventions] OK — no feature main, inline GraphQL, or raw /api/graphql fetch"
    );
    process.exit(0);
  }
  console.error("[validate-frontend-conventions] violations:");
  for (const v of violations) {
    console.error(`  - [${v.rule}] ${v.file}: ${v.message}`);
  }
  process.exit(1);
}
