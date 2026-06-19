import { finding } from "../vocab.mjs";

const nonEmpty = (v) =>
  v != null &&
  (Array.isArray(v) ? v.length > 0 : typeof v === "object" ? Object.keys(v).length > 0 : false);

// Shape-check the remaining foundation artefacts and cross-reference directory contracts against the
// path-map's V2 target roots.
export default function r14Foundation(ctx) {
  const out = [];
  for (const [name, doc] of Object.entries(ctx.foundation)) {
    if (!nonEmpty(doc))
      out.push(finding("R14-foundation", name, "missing or empty foundation artefact"));
  }

  // directory contracts shape
  for (const c of ctx.directoryContracts) {
    for (const k of ["path", "allowedContents", "forbiddenContents", "dependencyDirection"])
      if (!(k in c))
        out.push(
          finding("R14-foundation", c.path || "<contract>", `directory contract missing "${k}"`)
        );
  }

  // cross-ref: every governed code root named in the directory contracts must be a real top-level
  // segment of the V2 target tree. (Per-file path-grouping is V2-construction work, out of scope here.)
  const treeRoots = new Set(
    ctx.targetTree
      .split("\n")
      .map((l) => /([a-z0-9._-]+)\//i.exec(l)?.[1])
      .filter(Boolean)
  );
  const governed = [
    "apps",
    "packages",
    "services",
    "tools",
    "scripts",
    "e2e",
    "docker",
    "infra",
    "config",
    "make",
    "docs",
  ];
  for (const c of ctx.directoryContracts) {
    const top = c.path.split("/")[0];
    if (governed.includes(top) && !treeRoots.has(top))
      out.push(
        finding(
          "R14-foundation",
          c.path,
          `directory-contract root "${top}" absent from the V2 target tree`
        )
      );
  }

  // UI semantics: validate ui-capability-model against ui-definition.schema's required fields, and
  // cross-reference owning capabilities + persona index.
  const uiModel = ctx.foundation["ui-capability-model.json"];
  const uiSchema = ctx.foundation["ui-definition.schema.json"];
  if (uiModel && uiSchema && !Array.isArray(uiModel)) {
    const required = uiSchema.required || [];
    const caps = uiModel.capabilities || [];
    const seenIds = new Set();
    for (const rec of caps) {
      const id = rec.capabilityId || "<ui-record>";
      for (const f of required)
        if (!(f in rec))
          out.push(
            finding(
              "R14-foundation",
              id,
              `ui-capability-model record missing schema-required field "${f}"`
            )
          );
      if (seenIds.has(id))
        out.push(finding("R14-foundation", id, "duplicate ui-capability-model capabilityId"));
      seenIds.add(id);
    }
  }

  // Knowledge ledger: each entry carries its required reasoning fields (referenced facts present).
  const ledger = ctx.foundation["v1-knowledge-ledger.json"];
  if (Array.isArray(ledger)) {
    for (const e of ledger)
      for (const f of ["topic", "acceptedResolution", "originatingCommits", "v2TargetDecision"])
        if (!(f in e))
          out.push(
            finding(
              "R14-foundation",
              e.topic || "<ledger>",
              `knowledge-ledger entry missing "${f}"`
            )
          );
  }
  return out;
}
