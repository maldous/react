import { finding } from "../vocab.mjs";

const adrNum = (ref) => (/(\d{4})/.exec(ref || "") || [])[1];

// Independent decision/governance verification: every V2 decision is Accepted and has lineage; every
// referenced V1 ADR/action exists in the corpus; requires-v1-completion actions that need a decision
// link to a real one. (Unresolved V1 work itself surfaces as explicit R9 branch-cut blockers — the
// 25 requires-v1-completion capabilities — rather than via a fragile register-status parse.)
export default function r13DecisionGovernance(ctx) {
  const out = [];
  const lineageById = new Map(ctx.decisionLineage.map((l) => [l.v2AdrId, l]));

  for (const d of ctx.decisions) {
    if (d.status !== "Accepted")
      out.push(
        finding("R13-decision-governance", d.v2AdrId, `V2 decision not Accepted: ${d.status}`)
      );
    const lin = lineageById.get(d.v2AdrId);
    if (!lin) {
      out.push(finding("R13-decision-governance", d.v2AdrId, "V2 decision has no lineage entry"));
      continue;
    }
    if ((lin.v1Adrs || []).length === 0 && (lin.v1Actions || []).length === 0)
      out.push(
        finding("R13-decision-governance", d.v2AdrId, "lineage has no V1 ADR or action source")
      );
    for (const a of lin.v1Adrs || [])
      if (!ctx.adrIds.has(adrNum(a)))
        out.push(
          finding("R13-decision-governance", d.v2AdrId, `lineage references missing ADR ${a}`)
        );
    for (const a of lin.v1Actions || [])
      if (!ctx.actionMentions.has(a))
        out.push(
          finding("R13-decision-governance", d.v2AdrId, `lineage references unknown action ${a}`)
        );
  }

  // requires-v1-completion actions that name a decision must link to a real decision/action
  for (const c of ctx.capabilities) {
    if (c.status !== "requires-v1-completion" || !c.decisionRef) continue;
    const ref = c.decisionRef;
    const known =
      ctx.actionMentions.has(ref) ||
      !!ctx.actionRegister[ref] ||
      ctx.decisions.some((d) => d.v2AdrId === ref) ||
      /^V1C-/.test(ref);
    if (!known)
      out.push(
        finding("R13-decision-governance", c.capability, `decisionRef does not resolve: ${ref}`)
      );
  }
  return out;
}
