import { finding } from "../vocab.mjs";
import { capabilityExists, present, proofExists } from "./quality.mjs";

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
      "interactionType",
      "sharedContract",
      "dataOwnershipBoundary",
      "controlOwnershipBoundary",
      "ownershipBoundary",
      "failureBehaviour",
      "orderingRequirement",
      "retryIdempotencyBehaviour",
      "consistencyModel",
      "transactionBoundary",
      "compensationBehaviour",
      "environmentBehaviour",
      "securityBoundary",
      "auditBoundary",
      "proofReference",
      "sourceEvidence",
    ])
      if (!present(interaction[field]))
        out.push(finding("R25-cross-capability-semantics", id, `interaction missing "${field}"`));
    for (const field of ["producerCapability", "consumerCapability"])
      if (present(interaction[field]) && !capabilityExists(ctx, interaction[field]))
        out.push(
          finding(
            "R25-cross-capability-semantics",
            id,
            `${field} "${interaction[field]}" is not a delivered capability`
          )
        );
    if (present(interaction.proofReference) && !proofExists(ctx, interaction.proofReference))
      out.push(
        finding(
          "R25-cross-capability-semantics",
          id,
          "interaction proofReference does not exist in proof inventory/capability evidence"
        )
      );
  }
  const canonicalEvents = (ctx.foundation?.["event-semantics.json"]?.events || []).filter(
    (event) => event.category !== "test-only" && event.excludedFromProductReadiness !== true
  );
  if (
    canonicalEvents.length > 0 &&
    !doc.interactions.some((interaction) => interaction.interactionType === "event")
  )
    out.push(
      finding(
        "R25-cross-capability-semantics",
        "canonical-events",
        "canonical event producer/consumer relationships require at least one event interaction"
      )
    );
  return out;
}
