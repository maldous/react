import { finding } from "../vocab.mjs";
import { isGenericOperationalText, present, proofExists } from "./quality.mjs";

const LIVE_PROVIDER_TIERS = new Set([
  "live-substrate",
  "live-composed-provider",
  "external-production",
]);

const hasDb = (capability) =>
  /Postgres|pg_|migration|RLS|database|db/i.test(
    `${capability.adapter || ""} ${capability.port || ""} ${capability.category || ""} ${capability.semanticCompleteness?.stateModel || ""}`
  );
const tenantData = (capability) =>
  /tenant|organisation|RLS|storage|billing|meter|data|search|audit|history|governance|retention|legal hold|domain/i.test(
    `${capability.capability} ${capability.category} ${capability.contract || ""} ${capability.semanticCompleteness?.stateModel || ""}`
  );

export default function r27OperationalSemantics(ctx) {
  const out = [];
  const doc = ctx.foundation?.["operational-semantics.json"];
  if (!doc || !Array.isArray(doc.capabilities)) {
    return [
      finding(
        "R27-operational-semantics",
        "operational-semantics.json",
        "missing operational semantics"
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
        finding("R27-operational-semantics", subject, "capability has no operational semantics")
      );
      continue;
    }
    for (const field of [
      "deployBehaviour",
      "configBehaviour",
      "migrationBehaviour",
      "rollbackBehaviour",
      "backupRestoreRelationship",
      "partialFailureBehaviour",
      "degradedMode",
      "recoveryAction",
      "observabilitySignals",
      "metrics",
      "logs",
      "traces",
      "alertConditions",
      "runbookReference",
      "incidentClass",
      "dataLossRisk",
      "securityRisk",
      "tenantImpact",
      "operatorAction",
      "proofReference",
    ])
      if (!present(row[field]))
        out.push(
          finding("R27-operational-semantics", subject, `operational semantics missing "${field}"`)
        );
    for (const field of [
      "deployBehaviour",
      "configBehaviour",
      "migrationBehaviour",
      "rollbackBehaviour",
      "backupRestoreRelationship",
      "partialFailureBehaviour",
      "degradedMode",
      "recoveryAction",
      "operatorAction",
    ])
      if (isGenericOperationalText(row[field], subject))
        out.push(finding("R27-operational-semantics", subject, `${field} is generic or templated`));
    if ((row.observabilitySignals || []).some((signal) => /\.generic\b/i.test(signal)))
      out.push(
        finding("R27-operational-semantics", subject, "observability signal is category.generic")
      );
    if (LIVE_PROVIDER_TIERS.has(capability.proofTier) && !present(row.degradedMode))
      out.push(
        finding(
          "R27-operational-semantics",
          subject,
          "provider-backed capability has no degraded mode"
        )
      );
    if (hasDb(capability) && (!present(row.migrationBehaviour) || !present(row.rollbackBehaviour)))
      out.push(
        finding(
          "R27-operational-semantics",
          subject,
          "database-backed capability has no migration/rollback note"
        )
      );
    if (tenantData(capability) && !present(row.backupRestoreRelationship))
      out.push(
        finding(
          "R27-operational-semantics",
          subject,
          "tenant-data capability has no backup/restore relationship"
        )
      );
    if (!present(row.observabilitySignals))
      out.push(
        finding("R27-operational-semantics", subject, "capability has no observability signal")
      );
    if (present(row.proofReference) && !proofExists(ctx, row.proofReference))
      out.push(finding("R27-operational-semantics", subject, "proofReference does not exist"));
  }
  return out;
}
