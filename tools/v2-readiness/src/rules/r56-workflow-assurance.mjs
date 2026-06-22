import { reportFindings } from "./adversarial-usf-report-rule.mjs";

export default function r56WorkflowAssurance(ctx) {
  return reportFindings(ctx, "R56-workflow-assurance", "workflow");
}
