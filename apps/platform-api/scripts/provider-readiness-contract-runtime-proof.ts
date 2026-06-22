/**
 * Provider readiness CONTRACT proof (ADR-0070 / ADR-ACT-0266 — Tier-1 kernel).
 *
 * Proves the core invariant of the config plane: a provider's `ready` lifecycle is
 * ADAPTER-confirmed — the stored registry config can NEVER assert `ready` by itself.
 *  - configured + adapter ready        -> ready
 *  - configured + adapter degraded     -> degraded
 *  - configured + adapter unreachable  -> degraded
 *  - configured + NO adapter result    -> degraded (config alone never implies ready)
 *  - candidate                          -> candidate (a candidate is not delivered)
 *  - disabled                           -> disabled
 *
 * Pure function (deriveReadinessLifecycle); always runs, no backend required.
 * Usage: npm run proof:provider-readiness-contract
 */

import { deriveReadinessLifecycle } from "../src/usecases/provider-config.ts";
import assert from "node:assert/strict";

let failures = 0;
function check(label: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}` + (detail ? ` — ${detail}` : ""));
  if (!ok) failures++;
  assert.equal(ok, true, detail ? `${label}: ${detail}` : label);
}

function main(): void {
  console.log("# Provider readiness CONTRACT proof\n");

  check(
    "configured + adapter ready => ready",
    deriveReadinessLifecycle({ lifecycleState: "configured" }, { status: "ready" }) === "ready"
  );
  check(
    "configured + adapter degraded => degraded",
    deriveReadinessLifecycle({ lifecycleState: "configured" }, { status: "degraded" }) ===
      "degraded"
  );
  check(
    "configured + adapter unreachable => degraded",
    deriveReadinessLifecycle({ lifecycleState: "configured" }, { status: "unreachable" }) ===
      "degraded"
  );
  check(
    "configured + NO adapter result => degraded (config alone never implies ready)",
    deriveReadinessLifecycle({ lifecycleState: "configured" }, null) === "degraded"
  );
  check(
    "ready in config + adapter degraded => degraded (registry cannot self-assert ready)",
    deriveReadinessLifecycle({ lifecycleState: "ready" }, { status: "degraded" }) === "degraded"
  );
  check(
    "candidate stays candidate (a candidate is not a delivered capability)",
    deriveReadinessLifecycle({ lifecycleState: "candidate" }, { status: "ready" }) === "candidate"
  );
  check(
    "disabled stays disabled",
    deriveReadinessLifecycle({ lifecycleState: "disabled" }, { status: "ready" }) === "disabled"
  );

  console.log(failures === 0 ? "\n# ALL CHECKS PASSED" : `\n# ${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
