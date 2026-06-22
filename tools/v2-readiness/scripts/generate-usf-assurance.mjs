#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { loadContext } from "../src/load.mjs";
import { buildUSFAssurance } from "../src/usf-assurance.mjs";

const repoRoot = process.cwd();
const outDir = path.join(repoRoot, "docs/v2-foundation/usf-graph");
fs.mkdirSync(outDir, { recursive: true });

const ctx = loadContext({ repoRoot, strict: true });
const { reports, graphs } = buildUSFAssurance(ctx);

const writeJson = (name, value) => {
  fs.writeFileSync(path.join(outDir, name), `${JSON.stringify(value, null, 2)}\n`);
};

writeJson("capability-graph.json", graphs.capabilityGraph);
writeJson("event-graph.json", graphs.eventGraph);
writeJson("environment-graph.json", graphs.environmentGraph);
writeJson("proof-graph.json", graphs.proofGraph);
writeJson("security-graph.json", graphs.securityGraph);
writeJson("observability-graph.json", graphs.observabilityGraph);
writeJson("audit-graph.json", graphs.auditGraph);
writeJson("operational-graph.json", graphs.operationalGraph);
writeJson("dependency-graph.json", graphs.dependencyGraph);

writeJson("operational-assurance-report.json", reports.operationalAssurance);
writeJson("observability-coverage-report.json", reports.observabilityAssurance);
writeJson("security-assurance-report.json", reports.securityAssurance);
writeJson("audit-coverage-report.json", reports.auditAssurance);
writeJson("event-assurance-report.json", reports.eventAssurance);
writeJson("environment-assurance-report.json", reports.environmentAssurance);
writeJson("data-assurance-report.json", reports.dataAssurance);
writeJson("dependency-assurance-report.json", reports.dependencyAssurance);
writeJson("reliability-assurance-report.json", reports.reliabilityAssurance);
writeJson("capability-assurance-matrix.json", reports.capabilityCoverage);
writeJson("runtime-alignment-report.json", reports.runtimeAlignment);

const sections = [
  [
    "Semantic Assurance",
    {
      pass: true,
      rationale: "R30-R37 formal semantic assurance remains enforced by v2:readiness.",
    },
  ],
  ["Operational Assurance", reports.operationalAssurance],
  ["Observability Assurance", reports.observabilityAssurance],
  ["Security Assurance", reports.securityAssurance],
  ["Audit Assurance", reports.auditAssurance],
  ["Event Assurance", reports.eventAssurance],
  ["Environment Assurance", reports.environmentAssurance],
  ["Data Assurance", reports.dataAssurance],
  ["Dependency Assurance", reports.dependencyAssurance],
  ["Reliability Assurance", reports.reliabilityAssurance],
  ["Capability Coverage Assurance", reports.capabilityCoverage],
  ["Runtime Alignment Assurance", reports.runtimeAlignment],
];

const rationale = (name, report) => {
  if (report.rationale) return report.rationale;
  const violations = report.violations?.length || 0;
  if (name === "Operational Assurance")
    return `${report.capabilities.length} capabilities checked for deployment, config, migration, rollback, backup/restore, degraded/recovery modes, owner action, incidents, and runbook. violations=${violations}.`;
  if (name === "Observability Assurance")
    return `${report.capabilities.length} capabilities checked for traces, logs, metrics, alerts, mutation audit, and event trace correlation. violations=${violations}.`;
  if (name === "Security Assurance")
    return `${report.capabilities.length} capabilities checked for permissions, RBAC/ABAC/PDP policy, audit, secrets, data classification, and security risk. violations=${violations}.`;
  if (name === "Audit Assurance")
    return `${report.mutations.length} mutating capabilities checked for audit event, before/after, actor, resource, timestamp, and correlation. violations=${violations}.`;
  if (name === "Event Assurance")
    return `${report.events.length} events checked for owner, producer, consumer, schema, version, idempotency, retry, DLQ, retention, and privacy. violations=${violations}.`;
  if (name === "Environment Assurance")
    return `${report.rows.length} Capability x Environment cells checked for provider, mock/proof/promotion/rollback/tenant-data/network/secret policy. violations=${violations}.`;
  if (name === "Data Assurance")
    return `${report.dataCapabilities.length} tenant-data capabilities checked for owner, classification, retention, backup, restore, export, legal hold, DSR, and lineage. violations=${violations}.`;
  if (name === "Dependency Assurance")
    return `${report.capabilityDependencies.length} capability dependencies and ${report.providerDependencies.length} provider dependencies checked for ownership and explicit risk. violations=${violations}.`;
  if (name === "Reliability Assurance")
    return `${report.providerBackedCapabilities.length} provider-backed capabilities checked for timeout, retry, circuit-breaker/degraded, fallback, and recovery semantics. violations=${violations}.`;
  if (name === "Capability Coverage Assurance")
    return `${report.capabilities.length} capabilities checked across semantics, proofs, events, environments, operations, security, audit, observability, and governance. violations=${violations}.`;
  return `${report.capabilities.length} capabilities checked for semantic definition + proof + runtime evidence alignment. violations=${violations}.`;
};

const rows = [
  ["Assurance Domain", "Result", "Rationale"],
  ...sections.map(([name, report]) => [
    name,
    report.pass ? "PASS" : "FAIL",
    rationale(name, report),
  ]),
];
const widths = rows[0].map((_, index) => Math.max(...rows.map((row) => String(row[index]).length)));
const renderRow = (row) =>
  `| ${row.map((cell, index) => String(cell).padEnd(widths[index])).join(" | ")} |`;
const renderRule = () => `| ${widths.map((width) => "-".repeat(width)).join(" | ")} |`;

const attestation = `# Universal Service Foundation Assurance

Status: ${sections.every(([, report]) => report.pass) ? "PASS" : "FAIL"}

This attestation is generated from \`docs/v2-foundation/usf-graph/\` and the V2 readiness semantic artefacts.
It extends formal semantic assurance into operational, observability, security, audit, event, environment, data, dependency, reliability, capability coverage, and runtime alignment assurance.

${[renderRow(rows[0]), renderRule(), ...rows.slice(1).map(renderRow)].join("\n")}

The platform can answer assurance questions through the generated graph and report artefacts: unaudited mutations, untraced routes, capabilities without alerts, providers without degraded mode, events without DLQ, capabilities without recovery or ownership, tenant-data capabilities without backup, privileged actions without audit, environment contradictions, semantic orphans, and runtime claims without evidence.
`;

fs.writeFileSync(
  path.join(repoRoot, "docs/v2-foundation/universal-service-foundation-assurance.md"),
  attestation
);

console.log(`USF assurance generated in ${path.relative(repoRoot, outDir)}`);
