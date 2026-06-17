// ADR-ACT-0285 (closure) — confidence-ladder policy + evidence attestation tests.
import { test } from "node:test";
import assert from "node:assert/strict";
import { verifyLadder } from "../verify-ladder.mjs";

const T0 = Date.parse("2026-06-17T10:00:00Z");
const HOUR = 3_600_000;
const now = T0 + 5 * HOUR;

// Build a four-stage ladder, all FULL, strictly increasing, at one sha.
function ladder(overrides = {}) {
  const sha = overrides.sha ?? "abc1234";
  const mk = (i) => ({
    result: "passed",
    gitSha: sha,
    timestamp: new Date(T0 + i * HOUR).toISOString(),
    durationSeconds: 1,
  });
  return { dev: mk(0), test: mk(1), staging: mk(2), prod: mk(3), ...(overrides.stages ?? {}) };
}
const base = (stages, extra = {}) => ({
  stages,
  head: "abc1234",
  testedShaIsAncestor: true,
  changedSinceTested: [],
  nowMs: now,
  ...extra,
});

test("all four FULL at HEAD → ladder passes", () => {
  const r = verifyLadder(base(ladder()));
  assert.equal(r.ok, true, r.failures.join("\n"));
});

test("a degraded stage fails the ladder — even dev/test", () => {
  for (const stage of ["dev", "test", "staging", "prod"]) {
    const stages = ladder();
    stages[stage] = { ...stages[stage], result: "degraded", confidence: "DEGRADED" };
    const r = verifyLadder(base(stages));
    assert.equal(r.ok, false, `${stage} degraded should fail`);
    assert.ok(r.failures.some((f) => f.includes(stage) && /must be FULL\/passed/.test(f)));
  }
});

test("a failed stage fails the ladder", () => {
  const stages = ladder();
  stages.staging = { ...stages.staging, result: "failed" };
  const r = verifyLadder(base(stages));
  assert.equal(r.ok, false);
});

test("a missing stage fails the ladder", () => {
  const stages = ladder();
  delete stages.prod;
  const r = verifyLadder(base(stages));
  assert.equal(r.ok, false);
  assert.ok(r.failures.some((f) => /prod: evidence file missing/.test(f)));
});

test("mixed SHAs fail the ladder", () => {
  const stages = ladder();
  stages.prod = { ...stages.prod, gitSha: "deadbee" };
  const r = verifyLadder(base(stages, { head: "abc1234" }));
  assert.equal(r.ok, false);
  assert.ok(r.failures.some((f) => /DIFFERENT SHAs/.test(f)));
});

test("attestation: evidence-only commit on top of the tested commit PASSES", () => {
  // tested sha != head, tested is an ancestor, and the only changes are evidence/adr.
  const stages = ladder({ sha: "1111111" });
  const r = verifyLadder(
    base(stages, {
      head: "2222222",
      testedShaIsAncestor: true,
      changedSinceTested: ["docs/evidence/stages/prod-latest.json", "docs/adr/ACTION-REGISTER.md"],
    })
  );
  assert.equal(r.ok, true, r.failures.join("\n"));
});

test("attestation: a non-evidence path changed since the tested commit FAILS (stale)", () => {
  const stages = ladder({ sha: "1111111" });
  const r = verifyLadder(
    base(stages, {
      head: "2222222",
      testedShaIsAncestor: true,
      changedSinceTested: [
        "docs/evidence/stages/prod-latest.json",
        "tools/e2e/observability-correlation/src/index.mjs",
      ],
    })
  );
  assert.equal(r.ok, false);
  assert.ok(r.failures.some((f) => /non-evidence paths changed/.test(f)));
});

test("attestation: tested commit not an ancestor of HEAD FAILS", () => {
  const stages = ladder({ sha: "1111111" });
  const r = verifyLadder(
    base(stages, {
      head: "2222222",
      testedShaIsAncestor: false,
      changedSinceTested: ["docs/evidence/x.json"],
    })
  );
  assert.equal(r.ok, false);
  assert.ok(r.failures.some((f) => /not an ancestor of HEAD/.test(f)));
});

test("ordering: stages out of ladder time order FAIL", () => {
  const stages = ladder();
  stages.prod = { ...stages.prod, timestamp: new Date(T0 - HOUR).toISOString() };
  const r = verifyLadder(base(stages));
  assert.equal(r.ok, false);
  assert.ok(r.failures.some((f) => /ordering violated/.test(f)));
});

test("freshness: a ladder older than maxAge FAILS", () => {
  const r = verifyLadder(base(ladder(), { nowMs: T0 + 100 * HOUR, maxAgeHours: 24 }));
  assert.equal(r.ok, false);
  assert.ok(r.failures.some((f) => /stale/.test(f)));
});

// ── attestation security (#5) ────────────────────────────────────────────────
test("a malicious / malformed gitSha is REJECTED before any git call", () => {
  for (const evil of [
    "$(rm -rf /)",
    "abc;reboot",
    "--upload-pack=evil",
    "HEAD origin",
    "../etc",
    "zzzz",
  ]) {
    const stages = ladder({ sha: evil });
    const r = verifyLadder(base(stages, { head: "abc1234" }));
    assert.equal(r.ok, false, `evil sha must fail: ${evil}`);
    assert.ok(
      r.failures.some((f) => /not a valid git object id/.test(f)),
      `${evil}: ${r.failures.join("|")}`
    );
  }
});

test("a non-hex HEAD is REJECTED", () => {
  const r = verifyLadder(base(ladder(), { head: "$(touch pwned)" }));
  assert.equal(r.ok, false);
  assert.ok(r.failures.some((f) => /HEAD sha.*not a valid git object id/.test(f)));
});

test("fail-closed: an unresolved git diff (null changedSinceTested) FAILS", () => {
  const stages = ladder({ sha: "1111111" });
  const r = verifyLadder(
    base(stages, { head: "2222222", testedShaIsAncestor: true, changedSinceTested: null })
  );
  assert.equal(r.ok, false);
  assert.ok(r.failures.some((f) => /could not compute the diff.*fail-closed/.test(f)));
});

test("fail-closed: a non-ancestor / failed merge-base FAILS (not silently approved)", () => {
  const stages = ladder({ sha: "1111111" });
  const r = verifyLadder(
    base(stages, { head: "2222222", testedShaIsAncestor: false, changedSinceTested: [] })
  );
  assert.equal(r.ok, false);
  assert.ok(r.failures.some((f) => /not an ancestor of HEAD/.test(f)));
});
