import { finding } from "../vocab.mjs";

const has = (v, re) => typeof v === "string" && re.test(v);

// Field checks apply ONLY to delivered-and-proven records. requires-v1-completion records are
// expected to carry missing/not-yet-proven honestly and must not be flagged.
export default function r2Capability(ctx) {
  const out = [];
  for (const c of ctx.capabilities) {
    const subj = c.capability;
    if (c.status === "delivered-and-proven") {
      if (has(c.route, /missing/i))
        out.push(
          finding("R2-capability-integrity", subj, "delivered-and-proven but route is missing")
        );
      else if (has(c.route, /partial/i) && c.acceptablePartialRoute !== true)
        out.push(
          finding(
            "R2-capability-integrity",
            subj,
            "delivered-and-proven with a partial route and no acceptablePartialRoute:true"
          )
        );
      if (has(c.contract, /^\s*missing/i))
        out.push(
          finding("R2-capability-integrity", subj, "delivered-and-proven but contract is missing")
        );
      if (has(c.permission, /to define/i))
        out.push(
          finding(
            "R2-capability-integrity",
            subj,
            'delivered-and-proven but permission is "to define"'
          )
        );
      if (has(c.readinessCheck, /deferred|to define/i))
        out.push(
          finding(
            "R2-capability-integrity",
            subj,
            `delivered-and-proven but readiness is "${c.readinessCheck}"`
          )
        );
      if (has(c.proof, /not-yet-proven/i) || c.proof === "blocked")
        out.push(
          finding("R2-capability-integrity", subj, `delivered-and-proven but proof is "${c.proof}"`)
        );
      if (has(c.openAction, /must close|blocker|before v2 cut/i))
        out.push(
          finding(
            "R2-capability-integrity",
            subj,
            'delivered-and-proven with a "must close before V2 cut" openAction'
          )
        );
    }
    if (c.status === "requires-v1-completion" && !c.completionAction)
      out.push(
        finding(
          "R2-capability-integrity",
          subj,
          "requires-v1-completion without a completionAction"
        )
      );
  }
  return out;
}
