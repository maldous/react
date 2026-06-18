import { HARD_PLACEHOLDERS, UNRESOLVED_PIN, finding } from "../vocab.mjs";

// Closure-claim artefacts only — NOT the runbook/spec, which legitimately name the tokens.
export default function r1Placeholder(ctx) {
  const out = [];
  const sources = {
    "gap-report.md": ctx.gapReport,
    "v1-completion-programme.md": ctx.programme,
    "v1-capability-closure.json": JSON.stringify(ctx.capabilities),
    "zero-gap-reconciliation.json": JSON.stringify(ctx.reconciliation),
  };
  for (const [name, text] of Object.entries(sources)) {
    if (!text) continue;
    for (const token of HARD_PLACEHOLDERS) {
      // word-ish boundary for plain words; literal match for <undefined>
      const re =
        token === "<undefined>"
          ? /<undefined>/g
          : new RegExp(`\\b${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi");
      if (re.test(text))
        out.push(finding("R1-placeholder", name, `unresolved placeholder "${token}"`));
    }
  }
  if (ctx.strict && UNRESOLVED_PIN.includes(String(ctx.pinnedV1Commit).trim())) {
    out.push(
      finding(
        "R1-placeholder",
        "pinnedV1Commit",
        `pinned commit unresolved under --strict: "${ctx.pinnedV1Commit}"`
      )
    );
  }
  return out;
}
