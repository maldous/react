import { finding } from "../vocab.mjs";
import { buildFormalModel, buildReports, graphIntegrity } from "../formal-assurance.mjs";

export default function r30GraphIntegrity(ctx) {
  const generated = buildReports(ctx);
  const graph =
    ctx.formalModel?.["traceability-graph.json"] || buildFormalModel(ctx).traceabilityGraph;
  const report =
    graph === generated.model.traceabilityGraph
      ? generated.reports.graphIntegrity
      : graphIntegrity(graph);
  if (report.pass) return [];
  const out = [];
  for (const id of report.orphans)
    out.push(finding("R30-graph-integrity", id, "semantic graph node is orphaned"));
  for (const edge of report.danglingReferences)
    out.push(
      finding(
        "R30-graph-integrity",
        `${edge.from} -> ${edge.to}`,
        "semantic graph edge has a dangling reference"
      )
    );
  for (const cycle of report.cycles)
    out.push(finding("R30-graph-integrity", cycle.join(" -> "), "semantic graph cycle detected"));
  for (const id of report.unreachableNodes)
    out.push(finding("R30-graph-integrity", id, "capability node is unreachable"));
  for (const id of report.ownershipViolations)
    out.push(finding("R30-graph-integrity", id, "semantic node has no ownership chain"));
  for (const id of report.duplicateSemanticIdentities)
    out.push(finding("R30-graph-integrity", id, "duplicate semantic identity"));
  for (const edge of report.selfReferences)
    out.push(finding("R30-graph-integrity", edge.from, "self reference detected"));
  for (const edge of report.duplicateEdges)
    out.push(finding("R30-graph-integrity", `${edge.from} -> ${edge.to}`, "duplicate graph edge"));
  return out;
}
