import { finding } from "../vocab.mjs";

const present = (v) => v != null && v !== "" && !(Array.isArray(v) && v.length === 0);

export default function r28SemanticSourceTransition(ctx) {
  const out = [];
  const doc = ctx.foundation?.["semantic-source-of-truth-transition.json"];
  if (!doc || !doc.policies) {
    return [
      finding(
        "R28-semantic-source-transition",
        "semantic-source-of-truth-transition.json",
        "no post-V2 source-of-truth policy exists"
      ),
    ];
  }
  const policies = doc.policies;
  for (const field of [
    "v1Final",
    "v2SourceOfTruth",
    "driftPolicy",
    "changePolicy",
    "v1ReopenPolicy",
    "requiredChangeCoupling",
    "forbiddenChanges",
    "enforcementPath",
  ])
    if (!present(policies[field]))
      out.push(
        finding(
          "R28-semantic-source-transition",
          `semantic-source-of-truth-transition.json#${field}`,
          `source-of-truth policy missing "${field}"`
        )
      );
  if (!/historical evidence/i.test(policies.v1Final || ""))
    out.push(
      finding(
        "R28-semantic-source-transition",
        "v1Final",
        "V1-final policy must define V1 as historical evidence"
      )
    );
  if (
    !/semantic contracts|semantic asset|capability definitions/i.test(
      policies.v2SourceOfTruth || ""
    )
  )
    out.push(
      finding(
        "R28-semantic-source-transition",
        "v2SourceOfTruth",
        "V2 semantic contracts must be the post-cut source of truth"
      )
    );
  if (!/must not drift|drift/i.test(policies.driftPolicy || ""))
    out.push(
      finding(
        "R28-semantic-source-transition",
        "driftPolicy",
        "no rule requires V2 code not to drift from semantic artefacts"
      )
    );
  if (!/same change/i.test(policies.changePolicy || ""))
    out.push(
      finding(
        "R28-semantic-source-transition",
        "changePolicy",
        "no rule requires semantic artefacts to change with capability behaviour"
      )
    );
  if (!/evidence correction/i.test(policies.v1ReopenPolicy || ""))
    out.push(
      finding(
        "R28-semantic-source-transition",
        "v1ReopenPolicy",
        "V1 reopen policy must be limited to evidence correction"
      )
    );
  if (/V1 remains .*semantic authority forever/i.test(ctx.runbook || ""))
    out.push(
      finding(
        "R28-semantic-source-transition",
        "v2-branch-cut-runbook.md",
        "runbook still implies V1 remains the live semantic authority forever"
      )
    );
  const coupling = policies.requiredChangeCoupling || [];
  for (const item of [
    "capability definition",
    "contracts",
    "permissions",
    "validation",
    "errors",
    "events",
    "operational semantics",
    "environment semantics",
    "UI semantics",
    "proofs",
    "validator rules",
  ])
    if (!JSON.stringify(coupling).toLowerCase().includes(item.toLowerCase()))
      out.push(
        finding(
          "R28-semantic-source-transition",
          "requiredChangeCoupling",
          `change coupling missing ${item}`
        )
      );
  const forbidden = JSON.stringify(policies.forbiddenChanges || "").toLowerCase();
  for (const item of [
    "code behaviour",
    "ui behaviour",
    "event emission",
    "new provider",
    "new capability",
  ])
    if (!forbidden.includes(item))
      out.push(
        finding(
          "R28-semantic-source-transition",
          "forbiddenChanges",
          `forbidden drift cases missing ${item}`
        )
      );
  if (!/validator|readiness|proof|enforce/i.test(JSON.stringify(policies.enforcementPath || "")))
    out.push(
      finding("R28-semantic-source-transition", "enforcementPath", "no enforcement path is defined")
    );
  return out;
}
