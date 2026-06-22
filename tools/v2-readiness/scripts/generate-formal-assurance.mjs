#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { loadContext } from "../src/load.mjs";
import { buildReports } from "../src/formal-assurance.mjs";

const repoRoot = process.cwd();
const outDir = path.join(repoRoot, "docs/v2-foundation/formal-model");
fs.mkdirSync(outDir, { recursive: true });

const ctx = loadContext({ repoRoot, strict: true });
const { model, stateMachines, reports } = buildReports(ctx);

const writeJson = (name, value) => {
  fs.writeFileSync(path.join(outDir, name), `${JSON.stringify(value, null, 2)}\n`);
};

writeJson("capability-graph.json", model.capabilityGraph);
writeJson("event-graph.json", model.eventGraph);
writeJson("interaction-graph.json", model.interactionGraph);
writeJson("proof-graph.json", model.proofGraph);
writeJson("environment-graph.json", model.environmentGraph);
writeJson("traceability-graph.json", model.traceabilityGraph);
writeJson("state-machines.json", {
  artefact: "state-machines",
  version: 1,
  machines: stateMachines,
});
writeJson("graph-integrity-report.json", reports.graphIntegrity);
writeJson("state-machine-soundness-report.json", reports.stateMachineSoundness);
writeJson("traceability-matrix.json", reports.traceabilityClosure);
writeJson("environment-completeness-report.json", reports.environmentCompleteness);
writeJson("constraint-satisfaction-report.json", reports.constraintSatisfaction);
writeJson("semantic-closure-report.json", reports.semanticClosure);
writeJson("regeneration-sufficiency-report.json", reports.regenerationSufficiency);
writeJson("semantic-entropy-report.json", reports.semanticEntropy);

const sections = [
  ["Graph Integrity", reports.graphIntegrity],
  ["State Machine Soundness", reports.stateMachineSoundness],
  ["Traceability Closure", reports.traceabilityClosure],
  ["Environment Completeness", reports.environmentCompleteness],
  ["Constraint Satisfaction", reports.constraintSatisfaction],
  ["Semantic Closure", reports.semanticClosure],
  ["Regeneration Sufficiency", reports.regenerationSufficiency],
  ["Semantic Entropy", reports.semanticEntropy],
];

const rationale = (name, report) => {
  if (name === "Graph Integrity")
    return `${report.nodeCount} nodes and ${report.edgeCount} explicit edges; cycles=${report.cycles.length}, orphans=${report.orphans.length}, dangling=${report.danglingReferences.length}, ownershipViolations=${report.ownershipViolations.length}.`;
  if (name === "State Machine Soundness")
    return `${report.machineCount} lifecycle state machines; violations=${report.violations.length}.`;
  if (name === "Traceability Closure")
    return `${report.capabilities.length} capabilities traced through contracts, proofs, environments, operations, events/interactions or explicit absence semantics, and UI semantics; violations=${report.violations.length}.`;
  if (name === "Environment Completeness")
    return `${report.matrixRows} Capability x Environment cells checked; violations=${report.violations.length}.`;
  if (name === "Constraint Satisfaction")
    return `${report.constraintCount} constraints evaluated; violations=${report.violations.length}.`;
  if (name === "Semantic Closure")
    return `Runtime event names, proof scripts, state transitions, and delivered capability facets checked; violations=${report.violations.length}.`;
  if (name === "Regeneration Sufficiency")
    return `Reconstructed ${report.reconstructed.capabilityGraph} capabilities, ${report.reconstructed.interactionGraph} interactions, ${report.reconstructed.eventGraph} events, ${report.reconstructed.environmentMatrixRows} environment cells, and ${report.reconstructed.uiSemanticModelCapabilities} UI semantic capability definitions from semantic artefacts alone.`;
  return `Duplicate concepts=${report.duplicateConcepts.length}, duplicate ownership=${report.duplicateOwnership.length}, duplicate event definitions=${report.duplicateEventDefinitions.length}, contradictory definitions=${report.contradictoryDefinitions.length}.`;
};

const tableRows = [
  ["Assurance Area", "Result", "Rationale"],
  ...sections.map(([name, report]) => [
    name,
    report.pass ? "PASS" : "FAIL",
    rationale(name, report),
  ]),
];
const widths = tableRows[0].map((_, index) =>
  Math.max(...tableRows.map((row) => String(row[index]).length))
);
const renderRow = (row) =>
  `| ${row.map((cell, index) => String(cell).padEnd(widths[index])).join(" | ")} |`;
const renderRule = () => `| ${widths.map((width) => "-".repeat(width)).join(" | ")} |`;

const attestation = `# Mathematical Assurance Attestation

Status: ${sections.every(([, report]) => report.pass) ? "READY FOR V2 CUT" : "NOT READY"}

This attestation is generated from the formal semantic model under \`docs/v2-foundation/formal-model/\`.
The model treats V2 foundation semantics as a knowledge graph, state-machine system, and constraint system.

${[renderRow(tableRows[0]), renderRule(), ...tableRows.slice(1).map(renderRow)].join("\n")}

The assurance pass condition is that R30-R37 all pass and that no semantic orphan, unrepresented behaviour, unproven capability, ownerless event, policy-free environment, or semantics-free interaction remains.
`;

fs.writeFileSync(
  path.join(repoRoot, "docs/v2-foundation/mathematical-assurance-attestation.md"),
  attestation
);

console.log(`formal assurance generated in ${path.relative(repoRoot, outDir)}`);
