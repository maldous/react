import { reportFindings } from "./adversarial-usf-report-rule.mjs";

export default function r57EventRuntimeAssurance(ctx) {
  return reportFindings(ctx, "R57-event-runtime-assurance", "eventRuntime");
}
