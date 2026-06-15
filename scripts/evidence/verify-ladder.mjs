#!/usr/bin/env node
/**
 * Confidence-ladder verification (make all).
 *
 * `make all` is a confidence ladder: dev → test → staging → prod, each stage
 * building on the previous. Sequential failure-stop already guarantees no
 * later stage runs after an earlier failure — this verifier makes the ladder
 * itself an EXPLICIT, checkable invariant at the end of the run:
 *
 *   1. every stage evidence file exists (dev, test, staging, prod)
 *   2. staging and prod are "passed" (FULL confidence — real auth against a real
 *      domain); dev and test may be "passed" or "degraded" (they use fixture auth,
 *      so real-auth E2E is skipped by design). Any stage that is "failed" fails.
 *   3. every stage ran at the SAME git SHA — and that SHA is the current HEAD
 *      (no stale evidence from a previous commit can satisfy the ladder)
 *   4. stage timestamps are strictly increasing in ladder order
 *      (dev < test < staging < prod — proves the promotion ordering)
 *   5. the whole ladder is fresh (newest stage within MAX_AGE_HOURS, default 24)
 *
 * Exit 1 on any violation — `make all` fails rather than reporting a broken
 * or stale ladder as success.
 */

import fs from "node:fs";
import { execSync } from "node:child_process";

const DIR = "docs/evidence/stages";
const LADDER = ["dev", "test", "staging", "prod"];
const MAX_AGE_HOURS = Number(process.env.LADDER_MAX_AGE_HOURS ?? 24);

const failures = [];
const stages = {};

for (const stage of LADDER) {
  const path = `${DIR}/${stage}-latest.json`;
  if (!fs.existsSync(path)) {
    failures.push(`${stage}: evidence file missing (${path}) — stage did not run`);
    continue;
  }
  stages[stage] = JSON.parse(fs.readFileSync(path, "utf8"));
}

// ADR-ACT-0285 Phase 2 — the FULL-confidence (real-auth) requirement applies
// only to staging and prod, which run against real domains with real auth. dev
// and test deliberately use fixture auth, so their real-auth E2E is skipped and
// they report "degraded" by design — that is expected, not a promotion blocker.
// A genuine failure still sets "failed" (or the file is missing), which fails
// the ladder for every stage.
const REQUIRE_FULL_CONFIDENCE = new Set(["staging", "prod"]);
for (const [stage, ev] of Object.entries(stages)) {
  const acceptable = REQUIRE_FULL_CONFIDENCE.has(stage)
    ? ev.result === "passed"
    : ev.result === "passed" || ev.result === "degraded";
  if (!acceptable) {
    const conf = ev.confidence ? ` [${ev.confidence} CONFIDENCE]` : "";
    failures.push(
      `${stage}: result is "${ev.result}"${conf} (${ev.failureSummary ?? "no summary"})`
    );
  }
}

const head = execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
const shas = [...new Set(Object.values(stages).map((e) => e.gitSha))];
if (shas.length > 1) {
  failures.push(
    `stages ran at DIFFERENT SHAs (${shas.join(", ")}) — the ladder must be one commit`
  );
}
for (const [stage, ev] of Object.entries(stages)) {
  if (ev.gitSha !== head) {
    failures.push(`${stage}: evidence is for ${ev.gitSha}, but HEAD is ${head} (stale ladder)`);
  }
}

const times = LADDER.filter((s) => stages[s]).map((s) => ({
  stage: s,
  t: Date.parse(stages[s].timestamp),
}));
for (let i = 1; i < times.length; i++) {
  if (!(times[i].t > times[i - 1].t)) {
    failures.push(
      `ordering violated: ${times[i].stage} (${stages[times[i].stage].timestamp}) did not run after ${times[i - 1].stage} (${stages[times[i - 1].stage].timestamp})`
    );
  }
}

if (times.length > 0) {
  const newest = Math.max(...times.map((x) => x.t));
  const ageHours = (Date.now() - newest) / 3_600_000;
  if (ageHours > MAX_AGE_HOURS) {
    failures.push(
      `ladder is stale: newest stage is ${ageHours.toFixed(1)}h old (max ${MAX_AGE_HOURS}h)`
    );
  }
}

if (failures.length > 0) {
  console.error("✗ confidence ladder verification FAILED:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

console.log(
  `✓ confidence ladder verified: dev → test → staging → prod at ${head} (staging/prod FULL, dev/test ≥ degraded)`
);
for (const s of LADDER) {
  console.log(`  ${s.padEnd(8)} ${stages[s].timestamp}  (${stages[s].durationSeconds}s)`);
}
