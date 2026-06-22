import { finding } from "../vocab.mjs";

export const SEMANTIC_ASSETS = [
  "capability-definition.json",
  "capability-state-machine.json",
  "capability-permissions.json",
  "capability-errors.json",
  "capability-ui-contract.json",
  "capability-proof-definition.json",
];

export const REQUIRED_SEMANTIC_FACETS = [
  "lifecycle",
  "stateModel",
  "permissions",
  "contracts",
  "validation",
  "errorModel",
  "auditModel",
  "readinessModel",
  "proof",
  "uiSemanticDefinition",
];

const present = (v) =>
  v != null &&
  v !== "" &&
  !(Array.isArray(v) && v.length === 0) &&
  !(typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 0);

// R22 makes the new semantic completeness standard executable. Existing consistency checks prove
// that artefacts agree; this rule proves that a delivered capability has all ten semantic facets.
export default function r22SemanticCompleteness(ctx) {
  const out = [];
  for (const name of SEMANTIC_ASSETS) {
    const doc = ctx.foundation?.[name];
    if (!present(doc)) {
      out.push(finding("R22-semantic-completeness", name, "missing semantic foundation asset"));
      continue;
    }
    if (doc.mandatoryFoundationAsset !== true)
      out.push(
        finding(
          "R22-semantic-completeness",
          name,
          "semantic foundation asset must declare mandatoryFoundationAsset:true"
        )
      );
    const statuses = doc.coverage?.statuses || [];
    if (!statuses.includes("delivered-and-proven"))
      out.push(
        finding(
          "R22-semantic-completeness",
          name,
          "semantic foundation asset must cover delivered-and-proven capabilities"
        )
      );
  }

  for (const capability of ctx.capabilities || []) {
    if (capability.status !== "delivered-and-proven") continue;
    const subject = capability.capability || "<capability>";
    const completeness = capability.semanticCompleteness;
    if (!present(completeness)) {
      out.push(
        finding(
          "R22-semantic-completeness",
          subject,
          "delivered-and-proven capability lacks semanticCompleteness evidence"
        )
      );
      continue;
    }
    if (completeness.status !== "complete")
      out.push(
        finding(
          "R22-semantic-completeness",
          subject,
          'delivered-and-proven capability semanticCompleteness.status must be "complete"'
        )
      );
    for (const facet of REQUIRED_SEMANTIC_FACETS)
      if (!present(completeness[facet]))
        out.push(
          finding(
            "R22-semantic-completeness",
            subject,
            `semanticCompleteness missing required facet "${facet}"`
          )
        );
  }
  return out;
}
