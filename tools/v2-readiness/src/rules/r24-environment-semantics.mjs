import { finding } from "../vocab.mjs";

const present = (v) => v != null && v !== "" && !(Array.isArray(v) && v.length === 0);

export default function r24EnvironmentSemantics(ctx) {
  const out = [];
  const doc = ctx.foundation?.["environment-capability-matrix.json"];
  if (!doc || !Array.isArray(doc.capabilities)) {
    return [
      finding(
        "R24-environment-semantics",
        "environment-capability-matrix.json",
        "missing environment capability matrix"
      ),
    ];
  }
  const rows = new Map(doc.capabilities.map((row) => [row.capability, row]));
  for (const capability of ctx.capabilities || []) {
    if (capability.status !== "delivered-and-proven") continue;
    const subject = capability.capability;
    const row = rows.get(subject);
    if (!row) {
      out.push(
        finding("R24-environment-semantics", subject, "delivered capability has no environment row")
      );
      continue;
    }
    for (const env of ["dev", "test", "staging", "prod"]) {
      if (!row[env]) {
        out.push(
          finding("R24-environment-semantics", subject, `missing ${env} environment semantics`)
        );
        continue;
      }
      if (!present(row[env].provider))
        out.push(finding("R24-environment-semantics", subject, `${env} provider is missing`));
      if (!present(row[env].requiredProofs))
        out.push(
          finding("R24-environment-semantics", subject, `${env} required proofs are missing`)
        );
    }
    if (row.prod?.mocksAllowed === true)
      out.push(finding("R24-environment-semantics", subject, "prod allows mock providers"));
    if (row.staging?.prodLikeProof !== true)
      out.push(finding("R24-environment-semantics", subject, "staging lacks prod-like proof"));
    if (row.test?.paidLiveOnlyProvider === true || row.test?.liveProvidersRequired === true)
      out.push(
        finding("R24-environment-semantics", subject, "test relies on paid/live-only provider")
      );
    if (
      row.prod?.destructiveProofProdSafe === true ||
      row.prod?.destructiveProofsForbidden !== true
    )
      out.push(
        finding("R24-environment-semantics", subject, "destructive proof is marked prod-safe")
      );
    for (const env of ["dev", "test", "staging", "prod"])
      if (!present(row[env]?.promotionGate))
        out.push(finding("R24-environment-semantics", subject, `${env} promotion gate is missing`));
    if (row.prod?.smokeReadinessChecksAllowed !== true)
      out.push(
        finding(
          "R24-environment-semantics",
          subject,
          "prod must be limited to current health/smoke readiness checks"
        )
      );
  }
  return out;
}
