import { reportFindings } from "./adversarial-usf-report-rule.mjs";

export default function r55StorageAssurance(ctx) {
  return reportFindings(ctx, "R55-storage-assurance", "storage");
}
