import { reportFindings } from "./adversarial-usf-report-rule.mjs";

export default function r61SemanticOrphanRuntimeAssurance(ctx) {
  return reportFindings(ctx, "R61-semantic-orphan-runtime-assurance", "semanticOrphan");
}
