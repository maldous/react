import { finding } from "../vocab.mjs";

const claimsZero = (s) =>
  typeof s === "string" &&
  /zero[- ](unresolved[- ])?gaps|gap-free/i.test(s) &&
  !/not[- ]?zero|not gap-free|blocked|incomplete|may only be claimed|do not claim/i.test(s);

// Fire only on an AFFIRMATIVE zero-gap claim while real gaps remain — never on an honest negation.
export default function r3ZeroGap(ctx) {
  const gapsExist =
    ctx.capabilities.some((c) => c.status === "requires-v1-completion") ||
    (ctx.reconciliation?.semanticGapsRemaining?.count || 0) > 0;
  if (!gapsExist) return [];
  const candidates = [
    ["zero-gap-reconciliation.json#verdict", ctx.reconciliation?.verdict],
    ...ctx.gapReport
      .split("\n")
      .filter((l) => /verdict/i.test(l))
      .map((l) => ["gap-report.md", l]),
  ];
  return candidates
    .filter(([, s]) => claimsZero(s))
    .map(([subj, s]) =>
      finding(
        "R3-zero-gap-honesty",
        subj,
        `claims zero gaps while ${ctx.capabilities.filter((c) => c.status === "requires-v1-completion").length} capabilities require V1 completion: "${String(s).slice(0, 60)}"`
      )
    );
}
