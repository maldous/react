// ADR-ACT-0285 — the ONE confidence/exit contract shared by every required E2E
// group so the stage runner can aggregate results honestly.
//
//   PASSED / FULL → exit 0   (the group proved what it had to)
//   FAILED        → exit 1    (a required assertion failed — must fail the stage)
//   DEGRADED      → exit 2    (could not prove it — backend/config unavailable;
//                              NOT a pass — must prevent promotion)
//
// A DEGRADED group used to exit 0, which let a stage be labelled FULL while a
// required group had silently degraded (false-FULL). These helpers fix that.

/** Map a single result string to its process exit code. Throws on unknown input
 *  (a typo must never be silently treated as a pass). */
export function exitCodeForResult(result) {
  switch (String(result || "").toUpperCase()) {
    case "PASSED":
    case "FULL":
      return 0;
    case "FAILED":
      return 1;
    case "DEGRADED":
      return 2;
    default:
      throw new Error(
        `result-contract: unknown result "${result}" (expected PASSED/FULL/FAILED/DEGRADED)`
      );
  }
}

/** Combine several results into the worst one:
 *    any FAILED → FAILED ; else any DEGRADED → DEGRADED ; else PASSED.
 *  Used by tools that emit more than one sub-result (e.g. failure-rootcause
 *  produces both a root-cause result and a label-policy result). */
export function worstResult(results) {
  let sawDegraded = false;
  for (const r of results) {
    switch (String(r || "").toUpperCase()) {
      case "FAILED":
        return "FAILED";
      case "DEGRADED":
        sawDegraded = true;
        break;
      case "PASSED":
      case "FULL":
        break;
      default:
        throw new Error(`result-contract: unknown result "${r}"`);
    }
  }
  return sawDegraded ? "DEGRADED" : "PASSED";
}
