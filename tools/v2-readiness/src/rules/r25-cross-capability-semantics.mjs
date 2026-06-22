import { finding } from "../vocab.mjs";

const REQUIRED_INTERACTIONS = [
  "entitlements-billing",
  "billing-workflow",
  "workflow-notifications",
  "storage-governance",
  "governance-tenant-lifecycle",
  "audit-privileged-access",
  "catalog-provider-readiness",
  "events-workers-dlq",
];

const present = (v) => v != null && v !== "" && !(Array.isArray(v) && v.length === 0);

export default function r25CrossCapabilitySemantics(ctx) {
  const out = [];
  const doc = ctx.foundation?.["cross-capability-interactions.json"];
  if (!doc || !Array.isArray(doc.interactions)) {
    return [
      finding(
        "R25-cross-capability-semantics",
        "cross-capability-interactions.json",
        "missing cross-capability interaction semantics"
      ),
    ];
  }
  const delivered = new Set(
    (ctx.capabilities || [])
      .filter((capability) => capability.status === "delivered-and-proven")
      .map((capability) => capability.capability)
  );
  const shouldCrossCheckCapabilities = delivered.size > REQUIRED_INTERACTIONS.length;
  const byId = new Map(doc.interactions.map((interaction) => [interaction.id, interaction]));
  for (const id of REQUIRED_INTERACTIONS) {
    const interaction = byId.get(id);
    if (!interaction) {
      out.push(finding("R25-cross-capability-semantics", id, "known interaction lacks a contract"));
      continue;
    }
    for (const field of [
      "producerCapability",
      "consumerCapability",
      "sharedContract",
      "ownershipBoundary",
      "failureBehaviour",
      "orderingRequirement",
      "retryIdempotencyBehaviour",
      "proofReference",
    ])
      if (!present(interaction[field]))
        out.push(finding("R25-cross-capability-semantics", id, `interaction missing "${field}"`));
    for (const field of ["producerCapability", "consumerCapability"])
      if (
        shouldCrossCheckCapabilities &&
        present(interaction[field]) &&
        !delivered.has(interaction[field])
      )
        out.push(
          finding(
            "R25-cross-capability-semantics",
            id,
            `${field} "${interaction[field]}" is not a delivered capability`
          )
        );
  }
  return out;
}
