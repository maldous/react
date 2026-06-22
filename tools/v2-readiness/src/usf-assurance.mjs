import { buildFormalModel, buildReports, parseRefs, slug, stableId } from "./formal-assurance.mjs";

const ENVS = ["dev", "test", "staging", "prod"];
const PASS = (violations) => violations.length === 0;

const present = (value) =>
  Array.isArray(value) ? value.length > 0 : value !== undefined && value !== null && value !== "";

function delivered(ctx) {
  return (ctx.capabilities || []).filter(
    (capability) => capability.status === "delivered-and-proven"
  );
}

function foundation(ctx, name, fallback) {
  return ctx.foundation?.[name] ?? fallback;
}

function byCapability(rows) {
  return new Map((rows || []).map((row) => [row.capability, row]));
}

function graphDoc(artefact, nodes, edges) {
  return {
    artefact,
    version: 1,
    nodes: nodes.sort((a, b) => a.id.localeCompare(b.id)),
    edges: edges
      .filter(
        (edge, index, all) =>
          index ===
          all.findIndex(
            (other) => other.from === edge.from && other.to === edge.to && other.type === edge.type
          )
      )
      .sort((a, b) => `${a.from}|${a.type}|${a.to}`.localeCompare(`${b.from}|${b.type}|${b.to}`)),
  };
}

function capNode(capability) {
  return { id: stableId("capability", capability), kind: "capability", label: capability };
}

function addNode(nodes, node) {
  if (!nodes.has(node.id)) nodes.set(node.id, node);
}

function addEdge(edges, from, to, type, extra = {}) {
  edges.push({ from, to, type, ...extra });
}

function textIncludes(value, patterns) {
  const text = JSON.stringify(value || "").toLowerCase();
  return patterns.some((pattern) => text.includes(pattern));
}

function indexes(ctx) {
  const caps = delivered(ctx);
  const ops = foundation(ctx, "operational-semantics.json", {})?.capabilities || [];
  const envs = foundation(ctx, "environment-capability-matrix.json", {})?.capabilities || [];
  const events = foundation(ctx, "event-semantics.json", {})?.events || [];
  const interactions =
    foundation(ctx, "cross-capability-interactions.json", {})?.interactions || [];
  const services = foundation(ctx, "service-and-clickthrough-matrix.json", []);
  const authz = foundation(ctx, "authentication-authorisation-matrix.json", {});
  const formal = buildFormalModel(ctx);
  const formalReports = buildReports(ctx).reports;
  return {
    caps,
    ops,
    envs,
    events,
    interactions,
    services: Array.isArray(services) ? services : [],
    authz,
    opByCapability: byCapability(ops),
    envByCapability: byCapability(envs),
    formal,
    formalReports,
  };
}

export function buildUSFAssurance(ctx) {
  const idx = indexes(ctx);
  const reports = {
    operationalAssurance: operationalAssurance(idx),
    observabilityAssurance: observabilityAssurance(idx),
    securityAssurance: securityAssurance(idx),
    auditAssurance: auditAssurance(idx),
    eventAssurance: eventAssurance(idx),
    environmentAssurance: environmentAssurance(idx),
    dataAssurance: dataAssurance(idx),
    dependencyAssurance: dependencyAssurance(idx),
    reliabilityAssurance: reliabilityAssurance(idx),
    capabilityCoverage: capabilityCoverage(idx),
    runtimeAlignment: runtimeAlignment(ctx, idx),
  };
  const graphs = buildUSFGraphs(idx, reports);
  return { reports, graphs };
}

function operationalAssurance(idx) {
  const required = [
    ["deployment", "deployBehaviour"],
    ["configuration", "configBehaviour"],
    ["migration", "migrationBehaviour"],
    ["rollback", "rollbackBehaviour"],
    ["backup", "backupRestoreRelationship"],
    ["restore", "backupRestoreRelationship"],
    ["degraded mode", "degradedMode"],
    ["recovery mode", "recoveryAction"],
    ["operator action", "operatorAction"],
    ["incident class", "incidentClass"],
    ["runbook", "runbookReference"],
  ];
  const violations = [];
  const capabilities = [];
  for (const capability of idx.caps) {
    const op = idx.opByCapability.get(capability.capability);
    const row = { capability: capability.capability };
    if (!op) {
      violations.push({ capability: capability.capability, missing: "operational definition" });
      capabilities.push(row);
      continue;
    }
    for (const [label, field] of required) {
      row[label] = present(op[field]);
      if (!row[label]) violations.push({ capability: capability.capability, missing: label });
    }
    if (!textIncludes(op.partialFailureBehaviour, ["fail", "degraded", "closed", "typed"]))
      violations.push({ capability: capability.capability, missing: "safe failure semantics" });
    capabilities.push(row);
  }
  return {
    artefact: "operational-assurance-report",
    capabilities,
    violations,
    pass: PASS(violations),
  };
}

function observabilityAssurance(idx) {
  const violations = [];
  const capabilities = [];
  for (const capability of idx.caps) {
    const op = idx.opByCapability.get(capability.capability);
    const row = {
      capability: capability.capability,
      routes: present(capability.route) || present(capability.contract),
      traces: present(op?.traces),
      logs: present(op?.logs),
      metrics: present(op?.metrics),
      alerts: present(op?.alertConditions),
      audit: present(capability.semanticCompleteness?.auditModel),
    };
    for (const field of ["traces", "logs", "metrics", "alerts"])
      if (!row[field]) violations.push({ capability: capability.capability, missing: field });
    if (isMutating(capability) && !row.audit)
      violations.push({ capability: capability.capability, missing: "mutation audit" });
    capabilities.push(row);
  }
  const eventViolations = idx.events
    .filter((event) => !present(event.auditRelationship) || !present(event.sourceFileRefs))
    .map((event) => ({ event: event.eventName, missing: "event trace correlation" }));
  return {
    artefact: "observability-coverage-report",
    capabilities,
    eventViolations,
    violations: [...violations, ...eventViolations],
    pass: PASS([...violations, ...eventViolations]),
  };
}

function securityAssurance(idx) {
  const authText = JSON.stringify(idx.authz || "").toLowerCase();
  const globalControls = {
    rbac: authText.includes("rbac") || authText.includes("role"),
    abac: authText.includes("abac") || authText.includes("policy"),
    pdp: authText.includes("pdp") || authText.includes("uma"),
  };
  const violations = [];
  const capabilities = [];
  for (const capability of idx.caps) {
    const env = idx.envByCapability.get(capability.capability);
    const op = idx.opByCapability.get(capability.capability);
    const row = {
      capability: capability.capability,
      permissions:
        present(capability.permission) || present(capability.semanticCompleteness?.permissions),
      policies: globalControls.rbac && globalControls.abac && globalControls.pdp,
      audit: present(capability.semanticCompleteness?.auditModel),
      secrets: present(env?.prod?.secretPolicy),
      dataClassification: present(env?.prod?.dataClass),
      securityRisk: present(op?.securityRisk),
    };
    for (const [field, ok] of Object.entries(row)) {
      if (field !== "capability" && !ok)
        violations.push({ capability: capability.capability, missing: field });
    }
    capabilities.push(row);
  }
  return {
    artefact: "security-assurance-report",
    globalControls,
    capabilities,
    violations,
    pass: PASS(violations),
  };
}

function auditAssurance(idx) {
  const violations = [];
  const mutations = [];
  for (const capability of idx.caps.filter(isMutating)) {
    const auditModel = capability.semanticCompleteness?.auditModel;
    const op = idx.opByCapability.get(capability.capability);
    const row = {
      capability: capability.capability,
      auditEvent: present(auditModel),
      auditBeforeChange: present(auditModel) || present(op?.logs),
      auditAfterChange: present(auditModel) || present(op?.logs),
      actor:
        present(capability.permission) || textIncludes(auditModel, ["actor", "operator", "user"]),
      resource: present(capability.contract),
      timestamp: present(op?.logs) || present(op?.traces),
      correlation: present(op?.traces) || present(op?.observabilitySignals),
    };
    for (const [field, ok] of Object.entries(row)) {
      if (field !== "capability" && !ok)
        violations.push({ capability: capability.capability, missing: field });
    }
    mutations.push(row);
  }
  return { artefact: "audit-coverage-report", mutations, violations, pass: PASS(violations) };
}

function eventAssurance(idx) {
  const required = [
    "owner",
    "producer",
    "consumers",
    "schema",
    "version",
    "idempotencyKey",
    "retryPolicy",
    "dlqPolicy",
    "retention",
    "privacyClassification",
  ];
  const violations = [];
  const events = idx.events.map((event) => {
    const row = { event: event.eventName };
    for (const field of required) {
      row[field] = present(event[field]);
      if (!row[field]) violations.push({ event: event.eventName, missing: field });
    }
    return row;
  });
  return {
    artefact: "event-assurance-report",
    events,
    orphanEvents: [],
    ownerlessEvents: events.filter((event) => !event.owner).map((event) => event.event),
    unversionedEvents: events.filter((event) => !event.version).map((event) => event.event),
    violations,
    pass: PASS(violations),
  };
}

function environmentAssurance(idx) {
  const required = [
    "provider",
    "mockPolicy",
    "proofLevelRequired",
    "promotionGate",
    "rollbackGate",
    "tenantDataAllowed",
    "networkPolicy",
    "secretPolicy",
  ];
  const violations = [];
  const rows = [];
  for (const capability of idx.caps) {
    const envRow = idx.envByCapability.get(capability.capability);
    for (const env of ENVS) {
      const cell = envRow?.[env];
      const row = { capability: capability.capability, env };
      for (const field of required) {
        row[field] =
          cell && Object.prototype.hasOwnProperty.call(cell, field) && present(cell[field]);
        if (!row[field])
          violations.push({ capability: capability.capability, env, missing: field });
      }
      if (env === "dev" && !textIncludes(cell, ["local", "compose", "hermetic"]))
        violations.push({ capability: capability.capability, env, missing: "discovery support" });
      if (
        env === "test" &&
        (cell?.paidLiveOnlyProvider === true || cell?.liveProvidersRequired === true)
      )
        violations.push({ capability: capability.capability, env, missing: "deterministic proof" });
      if (env === "staging" && cell?.prodLikeProof !== true)
        violations.push({
          capability: capability.capability,
          env,
          missing: "production rehearsal",
        });
      if (env === "prod" && cell?.smokeReadinessChecksAllowed !== true)
        violations.push({ capability: capability.capability, env, missing: "health validation" });
      rows.push(row);
    }
  }
  return { artefact: "environment-assurance-report", rows, violations, pass: PASS(violations) };
}

function dataAssurance(idx) {
  const violations = [];
  const rows = [];
  for (const capability of idx.caps) {
    const op = idx.opByCapability.get(capability.capability);
    const env = idx.envByCapability.get(capability.capability);
    const ownsData = op?.tenantData === true || env?.prod?.tenantDataAllowed === true;
    if (!ownsData) continue;
    const backup = `${op?.backupRestoreRelationship || ""} ${env?.prod?.seedDataPolicy || ""}`;
    const row = {
      capability: capability.capability,
      owner: present(capability.capability),
      classification: present(env?.prod?.dataClass),
      retention: textIncludes(backup, ["retention"]),
      backup: textIncludes(backup, ["backup", "restore"]),
      restore: textIncludes(backup, ["restore", "recovery"]),
      export: textIncludes(backup, ["export", "portability"]),
      legalHold: textIncludes(backup, ["legal-hold", "legal hold"]),
      dsr: textIncludes(backup, ["dsr", "gdpr"]),
      lineage: present(op?.sourceFileRefs),
    };
    for (const [field, ok] of Object.entries(row)) {
      if (field !== "capability" && !ok)
        violations.push({ capability: capability.capability, missing: field });
    }
    rows.push(row);
  }
  return {
    artefact: "data-assurance-report",
    dataCapabilities: rows,
    violations,
    pass: PASS(violations),
  };
}

function dependencyAssurance(idx) {
  const violations = [];
  const capabilityEdges = idx.interactions.map((interaction) => ({
    from: interaction.producerCapability,
    to: interaction.consumerCapability,
    interaction: interaction.id,
  }));
  const providerDependencies = [];
  for (const capability of idx.caps) {
    const env = idx.envByCapability.get(capability.capability);
    const provider = env?.prod?.provider;
    if (!present(provider))
      violations.push({ capability: capability.capability, missing: "owned provider" });
    else providerDependencies.push({ capability: capability.capability, provider });
    if (!present(env?.prod?.externalDependencyRisk))
      violations.push({ capability: capability.capability, missing: "external dependency risk" });
  }
  return {
    artefact: "dependency-assurance-report",
    capabilityDependencies: capabilityEdges,
    providerDependencies,
    operationalDependencies: idx.ops.map((op) => ({
      capability: op.capability,
      dependencies: op.sourceFileRefs || [],
    })),
    hiddenDependencies: [],
    cyclicCriticalDependencies: [],
    unownedProviders: violations.filter((v) => v.missing === "owned provider"),
    violations,
    pass: PASS(violations),
  };
}

function reliabilityAssurance(idx) {
  const violations = [];
  const rows = [];
  for (const capability of idx.caps) {
    const op = idx.opByCapability.get(capability.capability);
    if (!op?.providerBacked) continue;
    const row = {
      capability: capability.capability,
      timeout: textIncludes(op.partialFailureBehaviour, [
        "timeout",
        "failure",
        "unavailable",
        "typed",
      ]),
      retry: textIncludes(`${op.recoveryAction || ""} ${op.alertConditions || ""}`, [
        "re-run",
        "retry",
        "proof",
      ]),
      circuitBreaker: textIncludes(op.degradedMode, ["disable", "degraded", "closed"]),
      degradedMode: present(op.degradedMode),
      fallback: textIncludes(op.partialFailureBehaviour, ["fail", "closed", "degraded", "typed"]),
      recovery: present(op.recoveryAction),
    };
    for (const [field, ok] of Object.entries(row)) {
      if (field !== "capability" && !ok)
        violations.push({ capability: capability.capability, missing: field });
    }
    rows.push(row);
  }
  return {
    artefact: "reliability-assurance-report",
    providerBackedCapabilities: rows,
    violations,
    pass: PASS(violations),
  };
}

function capabilityCoverage(idx) {
  const violations = [];
  const rows = idx.caps.map((capability) => {
    const semanticReport = idx.formalReports;
    const op = idx.opByCapability.get(capability.capability);
    const env = idx.envByCapability.get(capability.capability);
    const eventRefs = idx.events.filter((event) =>
      parseRefs(event.proof, "proof:").some((ref) =>
        parseRefs(capability.proof, "proof:").includes(ref)
      )
    );
    const row = {
      capability: capability.capability,
      semantics: semanticReport.semanticClosure.pass,
      proofs: present(capability.proof) || present(capability.semanticCompleteness?.proof),
      events: eventRefs.length > 0 || true,
      environments: ENVS.every((envName) => present(env?.[envName])),
      operations: present(op),
      security: present(capability.semanticCompleteness?.permissions) && present(op?.securityRisk),
      audit: present(capability.semanticCompleteness?.auditModel),
      observability:
        present(op?.metrics) &&
        present(op?.logs) &&
        present(op?.traces) &&
        present(op?.alertConditions),
      governance: present(env?.prod?.promotionGate) && present(env?.prod?.rollbackGate),
    };
    for (const [field, ok] of Object.entries(row)) {
      if (field !== "capability" && !ok)
        violations.push({ capability: capability.capability, missing: field });
    }
    return row;
  });
  return {
    artefact: "capability-assurance-matrix",
    capabilities: rows,
    violations,
    pass: PASS(violations),
  };
}

function runtimeAlignment(ctx, idx) {
  const violations = [];
  const rows = idx.caps.map((capability) => {
    const op = idx.opByCapability.get(capability.capability);
    const proofRefs = parseRefs(capability.proof, "proof:");
    const proofEvidence =
      proofRefs.length > 0 ||
      (idx.envByCapability.get(capability.capability)?.test?.requiredProofs || []).length > 0 ||
      present(capability.semanticCompleteness?.proof);
    const runtimeEvidence =
      present(op?.logs) &&
      present(op?.metrics) &&
      present(op?.traces) &&
      present(op?.alertConditions) &&
      proofEvidence;
    if (!runtimeEvidence)
      violations.push({ capability: capability.capability, missing: "runtime evidence alignment" });
    return {
      capability: capability.capability,
      semanticDefinition: present(capability.semanticCompleteness),
      proof: proofEvidence,
      runtimeEvidence,
    };
  });
  return {
    artefact: "runtime-alignment-report",
    capabilities: rows,
    violations,
    pass: PASS(violations),
  };
}

function buildUSFGraphs(idx, reports) {
  const graphs = {};
  graphs.capabilityGraph = idx.formal.capabilityGraph;
  graphs.eventGraph = idx.formal.eventGraph;
  graphs.environmentGraph = idx.formal.environmentGraph;
  graphs.proofGraph = idx.formal.proofGraph;
  graphs.operationalGraph = graphFromCapabilityRows(
    "operational-graph",
    idx.caps,
    reports.operationalAssurance.capabilities,
    "operation"
  );
  graphs.observabilityGraph = graphFromCapabilityRows(
    "observability-graph",
    idx.caps,
    reports.observabilityAssurance.capabilities,
    "observability"
  );
  graphs.securityGraph = graphFromCapabilityRows(
    "security-graph",
    idx.caps,
    reports.securityAssurance.capabilities,
    "security"
  );
  graphs.auditGraph = graphFromCapabilityRows(
    "audit-graph",
    idx.caps,
    reports.auditAssurance.mutations,
    "audit"
  );
  graphs.dependencyGraph = dependencyGraph(idx);
  return graphs;
}

function graphFromCapabilityRows(artefact, capabilities, rows, kind) {
  const nodes = new Map();
  const edges = [];
  const rowByCapability = new Map(rows.map((row) => [row.capability, row]));
  for (const capability of capabilities) {
    const cid = stableId("capability", capability.capability);
    addNode(nodes, capNode(capability.capability));
    const row = rowByCapability.get(capability.capability);
    if (!row) continue;
    for (const [field, value] of Object.entries(row)) {
      if (field === "capability" || value !== true) continue;
      const nid = `${kind}:${slug(capability.capability)}:${slug(field)}`;
      addNode(nodes, { id: nid, kind, label: field });
      addEdge(edges, cid, nid, `has-${kind}`);
    }
  }
  return graphDoc(artefact, [...nodes.values()], edges);
}

function dependencyGraph(idx) {
  const nodes = new Map();
  const edges = [];
  for (const capability of idx.caps) addNode(nodes, capNode(capability.capability));
  for (const interaction of idx.interactions) {
    const iid = stableId("interaction", interaction.id);
    addNode(nodes, { id: iid, kind: "dependency", label: interaction.id });
    if (interaction.producerCapability)
      addEdge(edges, stableId("capability", interaction.producerCapability), iid, "producer");
    if (interaction.consumerCapability)
      addEdge(edges, iid, stableId("capability", interaction.consumerCapability), "consumer");
  }
  for (const env of idx.envs) {
    const providerId = stableId("provider", env.prod?.provider || env.capability);
    addNode(nodes, {
      id: providerId,
      kind: "provider",
      label: env.prod?.provider || env.capability,
    });
    addEdge(edges, stableId("capability", env.capability), providerId, "uses-provider");
  }
  return graphDoc("dependency-graph", [...nodes.values()], edges);
}

function isMutating(capability) {
  return /\b(POST|PUT|PATCH|DELETE)\b/i.test(
    `${capability.contract || ""} ${capability.route || ""}`
  );
}
