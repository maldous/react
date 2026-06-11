#!/usr/bin/env node
// Usage: write-stage-evidence.mjs <stage> <result> <startTs> <requiredCsv> [excludedCsv]
// Writes docs/evidence/stages/<stage>-latest.json

import { writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import process from "node:process";

const [, , stage, result, startTs, requiredCsv, excludedCsv = ""] = process.argv;

if (!stage || !result || !startTs) {
  console.error(
    "Usage: write-stage-evidence.mjs <stage> <result> <startTs> <requiredCsv> [excludedCsv]"
  );
  process.exit(1);
}

function shell(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: "utf8" });
  return r.stdout?.trim() ?? "";
}

const gitSha = shell("git", ["rev-parse", "--short", "HEAD"]);
const timestamp = new Date().toISOString();
const durationSeconds = Math.round((Date.now() - new Date(startTs).getTime()) / 1000);

const envPath = `.env.${stage}`;
const composeProject = `react-${stage}`;

// Best-effort parse of a list field from stage-policy.yaml
function parsePolicyList(key) {
  const policyPath = "env/stage-policy.yaml";
  if (!existsSync(policyPath)) return [];
  const lines = readFileSync(policyPath, "utf8").split("\n");
  let inStage = false;
  let inKey = false;
  const results = [];
  for (const line of lines) {
    if (/^[a-z]/.test(line)) {
      inStage = line.trim() === `${stage}:`;
      inKey = false;
    }
    if (inStage && line.trim() === `${key}:`) {
      inKey = true;
      continue;
    }
    if (inKey && line.startsWith("    - ")) {
      results.push(line.trim().replace(/^- /, ""));
    }
    if (inKey && /^  [^ ]/.test(line)) {
      inKey = false;
    }
  }
  return results;
}

// Parse a scalar value from stage-policy.yaml
function parsePolicyScalar(key) {
  const policyPath = "env/stage-policy.yaml";
  if (!existsSync(policyPath)) return "unknown";
  const lines = readFileSync(policyPath, "utf8").split("\n");
  let inStage = false;
  for (const line of lines) {
    if (/^[a-z]/.test(line)) inStage = line.trim() === `${stage}:`;
    if (inStage) {
      const m = line.match(new RegExp(`^  ${key}:\\s*(.+)$`));
      if (m) return m[1].trim();
    }
  }
  return "unknown";
}

const testGroupsRun = requiredCsv
  ? requiredCsv
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  : [];
const testGroupsSkipped = excludedCsv
  ? excludedCsv
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  : [];

const e2eCommands = {
  dev: "make e2e-internal",
  test: "make e2e-internal",
  staging: "make e2e-external PROD_BASE_URL=https://staging.aldous.info",
  prod: "make e2e-external PROD_BASE_URL=https://aldous.info && npm run test:e2e:prod",
};

// Read the API port from the env file directly (no shell -> avoids command injection via $stage).
let apiPort = "3001";
try {
  const m = readFileSync(envPath, "utf8").match(/^\s*PLATFORM_API_PORT=(\d+)/m);
  if (m) apiPort = m[1];
} catch {
  /* env file absent - keep default */
}

const evidence = {
  stage,
  gitSha,
  timestamp,
  envFile: envPath,
  composeProject,
  profiles: parsePolicyList("profiles").length ? parsePolicyList("profiles") : ["default"],
  dataPolicy: parsePolicyScalar("dataPolicy"),
  testGroupsRun,
  testGroupsSkipped,
  e2eCommand: e2eCommands[stage] ?? "unknown",
  urlsChecked: [`http://localhost:${apiPort}/healthz`],
  result,
  durationSeconds,
  failureSummary: result === "failed" ? "See stage output for details." : null,
};

const dir = "docs/evidence/stages";
mkdirSync(dir, { recursive: true });
const path = `${dir}/${stage}-latest.json`;
writeFileSync(path, JSON.stringify(evidence, null, 2) + "\n");
console.log(`✓ evidence written to ${path}`);
