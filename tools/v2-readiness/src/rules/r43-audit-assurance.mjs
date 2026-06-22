import { finding } from "../vocab.mjs";
import { buildUSFAssurance } from "../usf-assurance.mjs";

export default function r43AuditAssurance(ctx) {
  return buildUSFAssurance(ctx).reports.auditAssurance.violations.map((violation) =>
    finding("R43-audit-assurance", violation.capability, `missing ${violation.missing}`)
  );
}
