#!/usr/bin/env node
/**
 * Confidence-ladder verification (make all) — ADR-ACT-0285 closure.
 *
 * `make all` is a confidence ladder: dev → test → staging → prod. This verifier makes
 * the ladder an EXPLICIT, checkable invariant at the end of the run:
 *
 *   1. every stage evidence file exists (dev, test, staging, prod).
 *   2. EVERY stage is "passed" (FULL confidence). A "degraded" OR "failed" stage — at ANY
 *      stage, dev/test included — fails the ladder. (Closure: dev/test may no longer pass
 *      as degraded; the honest contract makes every required group provable at every stage.)
 *   3. all stages ran at ONE tested commit (single gitSha).
 *   4. ATTESTATION (evidence-only-commit model): the tested commit is either HEAD itself
 *      (ran + verified before committing the generated evidence) OR an ancestor of HEAD
 *      whose cumulative diff to HEAD touches ONLY approved evidence/governance paths
 *      (docs/evidence/**, docs/adr/**). Committing the generated evidence therefore does
 *      NOT invalidate freshness; changing any source/tooling path after the tested run DOES
 *      (the diff then contains a non-approved path → stale → fail, demanding a re-run).
 *   5. stage timestamps strictly increasing in ladder order.
 *   6. the whole ladder is fresh (newest stage within MAX_AGE_HOURS, default 24).
 *
 * Exit 1 on any violation.
 */

import fs from "node:fs";
import { execFileSync } from "node:child_process";

const DIR = "docs/evidence/stages";
export const LADDER = ["dev", "test", "staging", "prod"];
const MAX_AGE_HOURS = Number(process.env.LADDER_MAX_AGE_HOURS ?? 24);

/** Paths that may legitimately change between the tested commit and HEAD without
 *  invalidating the ladder (the generated evidence + its governance records). */
export const APPROVED_PATH_RE = /^(docs\/evidence\/|docs\/adr\/)/;

/**
 * Pure ladder policy. Inputs are gathered by the CLI (git + fs) and injected so this is
 * unit-tested without a repo.
 *   stages: { [stage]: { result, gitSha, timestamp, confidence?, durationSeconds?, failureSummary? } }
 *   head: short sha of HEAD
 *   testedShaIsAncestor: boolean — is the stages' gitSha an ancestor of HEAD?
 *   changedSinceTested: string[] — `git diff --name-only <testedSha> HEAD` (empty if tested===head)
 *   nowMs, maxAgeHours
 * Returns { ok, failures }.
 */
/** A Git short/long object id: 7–40 lowercase hex. Anything else in an evidence file's
 *  gitSha is rejected BEFORE it can ever reach a git subprocess (no shell injection). */
export const GIT_SHA_RE = /^[0-9a-f]{7,40}$/;

export function verifyLadder({
  stages,
  head,
  testedShaIsAncestor,
  changedSinceTested,
  nowMs,
  maxAgeHours = MAX_AGE_HOURS,
}) {
  const failures = [];

  // 0. SHA hygiene — every recorded gitSha (and HEAD) must be a strict hex id. A malicious
  //    or malformed sha (e.g. "$(rm -rf /)") fails here and is NEVER passed to git.
  if (typeof head !== "string" || !GIT_SHA_RE.test(head))
    failures.push(`HEAD sha '${head}' is not a valid git object id`);
  for (const [stage, ev] of Object.entries(stages))
    if (typeof ev.gitSha !== "string" || !GIT_SHA_RE.test(ev.gitSha))
      failures.push(`${stage}: gitSha '${ev.gitSha}' is not a valid git object id`);

  // 1. presence
  for (const s of LADDER)
    if (!stages[s]) failures.push(`${s}: evidence file missing — stage did not run`);

  // 2. EVERY stage FULL (passed). No degraded/failed anywhere.
  for (const [stage, ev] of Object.entries(stages)) {
    if (ev.result !== "passed") {
      const conf = ev.confidence ? ` [${ev.confidence} CONFIDENCE]` : "";
      failures.push(
        `${stage}: result is "${ev.result}"${conf} — every stage must be FULL/passed (${ev.failureSummary ?? "no summary"})`
      );
    }
  }

  // 3. single tested commit
  const shas = [...new Set(Object.values(stages).map((e) => e.gitSha))];
  if (shas.length > 1)
    failures.push(
      `stages ran at DIFFERENT SHAs (${shas.join(", ")}) — the ladder must be one commit`
    );
  const testedSha = shas.length === 1 ? shas[0] : null;

  // 4. attestation (evidence-only-commit model) — FAIL CLOSED on any uncertainty.
  if (testedSha && GIT_SHA_RE.test(testedSha) && testedSha !== head) {
    if (!testedShaIsAncestor) {
      failures.push(
        `evidence tested commit ${testedSha} is not an ancestor of HEAD ${head} — stale/rebased ladder, or the merge-base check failed (fail-closed)`
      );
    } else if (changedSinceTested == null) {
      // git diff could not be computed → we cannot prove only-approved paths changed → reject.
      failures.push(
        `could not compute the diff since tested commit ${testedSha} (git failure) — fail-closed, re-run the ladder`
      );
    } else {
      const nonApproved = changedSinceTested.filter((p) => p && !APPROVED_PATH_RE.test(p));
      if (nonApproved.length) {
        failures.push(
          `non-evidence paths changed since the tested commit ${testedSha} (${nonApproved.slice(0, 8).join(", ")}${nonApproved.length > 8 ? ", …" : ""}) — re-run the ladder`
        );
      }
    }
  }

  // 5. ordering
  const times = LADDER.filter((s) => stages[s]).map((s) => ({
    stage: s,
    t: Date.parse(stages[s].timestamp),
  }));
  for (let i = 1; i < times.length; i++)
    if (!(times[i].t > times[i - 1].t))
      failures.push(
        `ordering violated: ${times[i].stage} (${stages[times[i].stage].timestamp}) did not run after ${times[i - 1].stage} (${stages[times[i - 1].stage].timestamp})`
      );

  // 6. freshness
  if (times.length > 0) {
    const newest = Math.max(...times.map((x) => x.t));
    const ageHours = (nowMs - newest) / 3_600_000;
    if (ageHours > maxAgeHours)
      failures.push(
        `ladder is stale: newest stage is ${ageHours.toFixed(1)}h old (max ${maxAgeHours}h)`
      );
  }

  return { ok: failures.length === 0, failures, testedSha };
}

function main() {
  const stages = {};
  for (const stage of LADDER) {
    const path = `${DIR}/${stage}-latest.json`;
    if (fs.existsSync(path)) stages[stage] = JSON.parse(fs.readFileSync(path, "utf8"));
  }

  // All git invocations use execFileSync ARGUMENT ARRAYS (never a shell string), and every
  // sha is validated against GIT_SHA_RE before it is passed as an argument — so a malicious
  // gitSha in an evidence JSON can neither inject a shell command nor a git option.
  const git = (args) => execFileSync("git", args, { encoding: "utf8" }).trim();
  const head = git(["rev-parse", "--short", "HEAD"]);
  const shas = [...new Set(Object.values(stages).map((e) => e.gitSha))];
  const testedSha = shas.length === 1 ? shas[0] : null;

  let testedShaIsAncestor = false;
  // null = "could not determine" → verifyLadder fails closed. [] = "determined: no changes".
  let changedSinceTested = [];
  const shaSafe = testedSha && GIT_SHA_RE.test(testedSha) && GIT_SHA_RE.test(head);
  if (shaSafe && testedSha !== head) {
    try {
      execFileSync("git", ["merge-base", "--is-ancestor", testedSha, "HEAD"], { stdio: "ignore" });
      testedShaIsAncestor = true;
    } catch {
      testedShaIsAncestor = false; // non-ancestor OR bad ref OR git failure → fail closed
    }
    try {
      changedSinceTested = git(["diff", "--name-only", testedSha, "HEAD"])
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);
    } catch {
      changedSinceTested = null; // git failure → cannot prove approved-only → fail closed
    }
  }

  const { ok, failures } = verifyLadder({
    stages,
    head,
    testedShaIsAncestor,
    changedSinceTested,
    nowMs: Date.now(),
  });

  if (!ok) {
    console.error("✗ confidence ladder verification FAILED:");
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }

  console.log(
    `✓ confidence ladder verified: dev → test → staging → prod (ALL FULL) at ${testedSha ?? head}` +
      (testedSha && testedSha !== head ? ` (evidence-only commit on top of HEAD ${head})` : "")
  );
  for (const s of LADDER)
    if (stages[s])
      console.log(`  ${s.padEnd(8)} ${stages[s].timestamp}  (${stages[s].durationSeconds}s)`);
}

import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
const invokedDirectly =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) main();
