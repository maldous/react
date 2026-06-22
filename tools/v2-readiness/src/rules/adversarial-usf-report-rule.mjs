import fs from "node:fs";
import path from "node:path";
import { finding } from "../vocab.mjs";
import { buildAdversarialUSFAudit } from "../adversarial-usf-audit.mjs";

export function reportFindings(ctx, ruleId, reportName) {
  if (!ctx.repoRoot) return [];
  if (!fs.existsSync(path.join(ctx.repoRoot, "apps/platform-api/src/server/routes.ts"))) return [];
  const report = buildAdversarialUSFAudit(ctx).reports[reportName];
  return (report?.gaps || []).map((gap) =>
    finding(ruleId, gap.subject, `${gap.message} [${gap.classification}]`)
  );
}
