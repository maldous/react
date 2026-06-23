import fs from "node:fs";
import { finding } from "../vocab.mjs";
import { buildAdversarialUSFAudit } from "../adversarial-usf-audit.mjs";
import { buildProofEvidenceAssurance } from "../proof-evidence.mjs";

export default function r62FormalProofEvidenceAssurance(ctx) {
  if (!ctx.repoRoot || !fs.existsSync(ctx.repoRoot)) return [];
  const out = [];
  const audit = buildAdversarialUSFAudit(ctx);
  const assurance = buildProofEvidenceAssurance(ctx, audit);

  for (const gap of assurance.formalReadiness.gaps) {
    out.push(
      finding(
        "R62-formal-proof-evidence-assurance",
        gap.subject || "<proof-evidence>",
        gap.message || gap.kind
      )
    );
  }

  for (const row of ctx.foundation?.["environment-capability-matrix.json"]?.capabilities || []) {
    if (row.dev?.providerClass === "in-memory" && row.dev?.composeRequired === true) {
      out.push(
        finding(
          "R62-formal-proof-evidence-assurance",
          row.capability || row.id || "<capability>",
          "semantic-dev in-memory provider still requires Compose"
        )
      );
    }
  }

  return out;
}
