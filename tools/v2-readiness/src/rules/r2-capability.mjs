import { finding } from "../vocab.mjs";

const has = (v, re) => typeof v === "string" && re.test(v);
const LIVE_PROVIDER_TIERS = new Set([
  "live-substrate",
  "live-composed-provider",
  "external-production",
]);

const providerBacked = (c) =>
  /billing|workflow|observability|storage|security|backup|pitr|antivirus/i.test(
    `${c.capability} ${c.category || ""} ${c.route || ""} ${c.contract || ""} ${c.evidence || ""}`
  );

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
      if (c.proofTier && !LIVE_PROVIDER_TIERS.has(c.proofTier)) {
        const requiresLive = providerBacked(c);
        if (requiresLive)
          out.push(
            finding(
              "R2-capability-integrity",
              subj,
              `delivered-and-proven but proofTier is ${c.proofTier}, not a live-provider tier`
            )
          );
      }
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
