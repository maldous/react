import { finding } from "../vocab.mjs";
import {
  VALID_PROVIDER_CLASSES,
  present,
  proofExists,
  validEnvironmentPolicy,
} from "./quality.mjs";

const envs = ["dev", "test", "staging", "prod"];

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
    for (const env of envs) {
      if (!row[env]) {
        out.push(
          finding("R24-environment-semantics", subject, `missing ${env} environment semantics`)
        );
        continue;
      }
      if (!validEnvironmentPolicy(row[env], env))
        out.push(
          finding(
            "R24-environment-semantics",
            subject,
            `${env} environment policy is incomplete or invalid`
          )
        );
      if (!VALID_PROVIDER_CLASSES.has(row[env].providerClass))
        out.push(finding("R24-environment-semantics", subject, `${env} providerClass is invalid`));
      if (env !== "prod" && !proofExists(ctx, row[env].requiredProofs))
        out.push(
          finding(
            "R24-environment-semantics",
            subject,
            `${env} requiredProofs do not map to proof inventory/capability evidence`
          )
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
    if (row.dev?.providerClass !== "in-memory")
      out.push(
        finding(
          "R24-environment-semantics",
          subject,
          "semantic-dev provider mode requires dev providerClass=in-memory"
        )
      );
    if (row.test?.providerClass !== "compose-local")
      out.push(
        finding(
          "R24-environment-semantics",
          subject,
          "test provider mode requires compose-local real provider parity"
        )
      );
    for (const env of ["staging", "prod"]) {
      if (row[env]?.providerClass === "in-memory" && row[env]?.dataClass !== "non-runtime-static") {
        out.push(
          finding(
            "R24-environment-semantics",
            subject,
            `${env} must not use in-memory runtime providers`
          )
        );
      }
    }
    if (
      row.prod?.destructiveProofProdSafe === true ||
      row.prod?.destructiveProofsForbidden !== true
    )
      out.push(
        finding("R24-environment-semantics", subject, "destructive proof is marked prod-safe")
      );
    for (const env of envs)
      if (!present(row[env]?.promotionGate))
        out.push(finding("R24-environment-semantics", subject, `${env} promotion gate is missing`));
    for (const env of envs)
      if (!present(row[env]?.rollbackGate))
        out.push(finding("R24-environment-semantics", subject, `${env} rollback gate is missing`));
    if (row.prod?.smokeReadinessChecksAllowed !== true)
      out.push(
        finding(
          "R24-environment-semantics",
          subject,
          "prod must be limited to current health/smoke readiness checks"
        )
      );
    if ((row.prod?.requiredProofs || []).some((proof) => /^proof:/.test(proof)))
      out.push(
        finding(
          "R24-environment-semantics",
          subject,
          "prod requiredProofs must be limited to readiness/smoke/synthetic checks"
        )
      );
    if (
      row.prod?.mocksAllowed !== false ||
      !/mock/i.test(row.prod?.mockPolicy || "") ||
      !/forbidden/i.test(row.prod?.mockPolicy || "")
    )
      out.push(finding("R24-environment-semantics", subject, "prod mock policy is not closed"));
  }
  return out;
}
