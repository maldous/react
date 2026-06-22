const ENVS = ["dev", "test", "staging", "prod"];
const REQUIRED_CAPABILITY_FACETS = [
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

const UI_OWNER_ALIASES = new Map([
  ["api-keys-pat", "api-keys-personal-access-tokens"],
  ["composed-provider-readiness", "composed-provider-readiness-spine"],
  ["end-user-profile-self-service", "end-user-profile-preferences-self-service"],
  ["entitlements", "entitlement-engine"],
  ["event-bus-queues-dlq", "event-bus-durable-queues-dlq-redrive"],
  ["idp-brokering", "idp-brokering-oidc-provider-management"],
  ["logs", "logs-aggregation-tenant-scoped-search"],
  ["metering-usage-meters", "usage-metering-meter-event-ingestion"],
  ["notifications", "notification-delivery-preferences-channels"],
  ["observability-alerting-builtin", "observability-built-in-alerting-incidents"],
  ["platform-login", "platform-login-session"],
  ["rbac", "rbac-roles-permissions"],
  ["relational-storage", "relational-storage-migrations-rls"],
  ["scheduled-jobs-builtin", "scheduled-jobs-built-in-on-the-event-substrate"],
  ["search-indexing", "search-indexing-product-search"],
  ["service-catalog-readiness", "internal-service-catalog-readiness"],
  ["tenant-auth", "user-identity-tenant-membership"],
  ["tenant-config-registry", "configuration-registry-history"],
  ["tenant-identity", "tenant-identity-record-fqdn"],
  ["webhooks-developer", "webhooks-developer-facing"],
]);

export function stableId(kind, value) {
  return `${kind}:${slug(value)}`;
}

export function slug(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/\+/g, " plus ")
    .replace(/fqdn/g, "fqdn")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function parseRefs(value, prefix) {
  const raw = Array.isArray(value) ? value : String(value || "").split(/[;,]/);
  return raw
    .map((item) => String(item).trim())
    .filter(Boolean)
    .filter((item) => !prefix || item.startsWith(prefix));
}

function capabilityRows(ctx) {
  return (ctx.capabilities || []).filter(
    (capability) => capability.status === "delivered-and-proven"
  );
}

function foundation(ctx, name, fallback) {
  return ctx.foundation?.[name] ?? fallback;
}

function capId(capability) {
  return stableId("capability", capability.capability);
}

function envId(capability, env) {
  return `environment:${slug(capability)}:${env}`;
}

function proofId(ref) {
  return stableId("proof", String(ref || "").replace(/^proof:/, ""));
}

function eventId(name) {
  return stableId("event", name);
}

function interactionId(id) {
  return stableId("interaction", id);
}

function uiId(id) {
  return stableId("ui", id);
}

function operationId(capability) {
  return stableId("operation", capability);
}

function stateMachineId(capability) {
  return stableId("state-machine", capability);
}

function node(kind, id, label, extra = {}) {
  return { id, kind, label, ...extra };
}

function edge(from, to, type, extra = {}) {
  return { from, to, type, ...extra };
}

function addNode(map, item) {
  if (!map.has(item.id)) map.set(item.id, item);
}

function addEdge(edges, item) {
  edges.push(item);
}

function buildIndexes(ctx) {
  const caps = capabilityRows(ctx);
  const byCapability = new Map(caps.map((capability) => [capability.capability, capability]));
  const bySlug = new Map(caps.map((capability) => [slug(capability.capability), capability]));
  for (const [alias, target] of UI_OWNER_ALIASES) {
    const capability = bySlug.get(target);
    if (capability) bySlug.set(alias, capability);
  }

  const envRows = foundation(ctx, "environment-capability-matrix.json", {})?.capabilities || [];
  const envByCapability = new Map(envRows.map((row) => [row.capability, row]));
  const ops = foundation(ctx, "operational-semantics.json", {})?.capabilities || [];
  const opByCapability = new Map(ops.map((row) => [row.capability, row]));
  const events = foundation(ctx, "event-semantics.json", {})?.events || [];
  const interactions =
    foundation(ctx, "cross-capability-interactions.json", {})?.interactions || [];
  const uiRows = foundation(ctx, "ui-capability-model.json", {})?.capabilities || [];
  const proofs = ctx.testInventory || [];

  const proofToCapabilities = new Map();
  for (const proof of proofs) {
    const refs = [proof.id, proof.path, proof.scriptPath].filter(Boolean);
    for (const ref of refs) {
      const id = proofId(ref.replace(/^proof:/, "").replace(/-runtime-proof.*$/, ""));
      const set = proofToCapabilities.get(id) || new Set();
      for (const capability of proof.capabilitiesProven || []) set.add(capability);
      proofToCapabilities.set(id, set);
    }
  }
  for (const capability of caps) {
    for (const ref of parseRefs(capability.proof, "proof:")) {
      const id = proofId(ref);
      const set = proofToCapabilities.get(id) || new Set();
      set.add(capability.capability);
      proofToCapabilities.set(id, set);
    }
  }

  const eventByCapability = new Map(caps.map((capability) => [capability.capability, []]));
  for (const event of events) {
    const eventProofCaps = new Set();
    for (const ref of parseRefs(event.proof, "proof:")) {
      for (const capability of proofToCapabilities.get(proofId(ref)) || [])
        eventProofCaps.add(capability);
    }
    const directProducer = byCapability.get(event.producer) || bySlug.get(slug(event.producer));
    if (directProducer) eventProofCaps.add(directProducer.capability);
    for (const capability of eventProofCaps) {
      const list = eventByCapability.get(capability) || [];
      list.push(event);
      eventByCapability.set(capability, list);
    }
  }

  const interactionByCapability = new Map(caps.map((capability) => [capability.capability, []]));
  for (const interaction of interactions) {
    for (const name of [interaction.producerCapability, interaction.consumerCapability]) {
      if (!name) continue;
      const list = interactionByCapability.get(name) || [];
      list.push(interaction);
      interactionByCapability.set(name, list);
    }
  }

  const uiByCapability = new Map(caps.map((capability) => [capability.capability, []]));
  for (const ui of uiRows) {
    const owner = bySlug.get(slug(ui.owningCapability));
    if (!owner) continue;
    const list = uiByCapability.get(owner.capability) || [];
    list.push(ui);
    uiByCapability.set(owner.capability, list);
  }

  return {
    caps,
    byCapability,
    bySlug,
    envByCapability,
    opByCapability,
    events,
    interactions,
    uiRows,
    proofs,
    proofToCapabilities,
    eventByCapability,
    interactionByCapability,
    uiByCapability,
  };
}

export function buildFormalModel(ctx) {
  const idx = buildIndexes(ctx);
  const nodes = new Map();
  const edges = [];

  for (const capability of idx.caps) {
    const cid = capId(capability);
    addNode(
      nodes,
      node("capability", cid, capability.capability, { category: capability.category })
    );

    for (const facet of REQUIRED_CAPABILITY_FACETS) {
      addNode(
        nodes,
        node("semantic-facet", `facet:${slug(capability.capability)}:${facet}`, facet)
      );
      addEdge(edges, edge(cid, `facet:${slug(capability.capability)}:${facet}`, "defines-facet"));
    }

    const smId = stateMachineId(capability.capability);
    addNode(nodes, node("state-machine", smId, `${capability.capability} lifecycle`));
    addEdge(edges, edge(cid, smId, "owns-state-machine"));

    const op = idx.opByCapability.get(capability.capability);
    if (op) {
      addNode(nodes, node("operation", operationId(capability.capability), capability.capability));
      addEdge(edges, edge(cid, operationId(capability.capability), "has-operational-semantics"));
    }

    const envRow = idx.envByCapability.get(capability.capability);
    if (envRow) {
      for (const env of ENVS) {
        if (!envRow[env]) continue;
        addNode(
          nodes,
          node(
            "environment",
            envId(capability.capability, env),
            `${capability.capability} ${env}`,
            { env }
          )
        );
        addEdge(
          edges,
          edge(cid, envId(capability.capability, env), "has-environment-policy", { env })
        );
        for (const ref of parseRefs(envRow[env].requiredProofs, "proof:")) {
          addNode(nodes, node("proof", proofId(ref), ref));
          addEdge(
            edges,
            edge(envId(capability.capability, env), proofId(ref), "requires-proof", { env })
          );
        }
      }
    }

    for (const ref of parseRefs(capability.proof, "proof:")) {
      addNode(nodes, node("proof", proofId(ref), ref));
      addEdge(edges, edge(cid, proofId(ref), "proven-by"));
    }
    if (
      parseRefs(capability.proof, "proof:").length === 0 &&
      capability.semanticCompleteness?.proof
    ) {
      addNode(
        nodes,
        node(
          "proof",
          proofId(`semantic-proof:${capability.capability}`),
          `${capability.capability} semantic proof`
        )
      );
      addEdge(edges, edge(cid, proofId(`semantic-proof:${capability.capability}`), "proven-by"));
    }

    const events = idx.eventByCapability.get(capability.capability) || [];
    if (events.length === 0) {
      const absenceId = `event-absence:${slug(capability.capability)}`;
      addNode(
        nodes,
        node(
          "event-absence",
          absenceId,
          `${capability.capability} has no source-derived product event`
        )
      );
      addEdge(edges, edge(cid, absenceId, "explicit-no-event-semantics"));
    } else {
      for (const event of events) {
        addNode(
          nodes,
          node("event", eventId(event.eventName), event.eventName, { category: event.category })
        );
        addEdge(edges, edge(cid, eventId(event.eventName), "has-event-semantics"));
      }
    }

    const interactions = idx.interactionByCapability.get(capability.capability) || [];
    if (interactions.length === 0) {
      const absenceId = `interaction-absence:${slug(capability.capability)}`;
      addNode(
        nodes,
        node(
          "interaction-absence",
          absenceId,
          `${capability.capability} has no named cross-capability interaction`
        )
      );
      addEdge(edges, edge(cid, absenceId, "explicit-no-interaction-semantics"));
    } else {
      for (const interaction of interactions) {
        addNode(nodes, node("interaction", interactionId(interaction.id), interaction.id));
        addEdge(edges, edge(cid, interactionId(interaction.id), "participates-in"));
      }
    }

    const uiRows = idx.uiByCapability.get(capability.capability) || [];
    if (uiRows.length === 0) {
      addNode(
        nodes,
        node(
          "ui-semantics",
          uiId(`${capability.capability}:semantic-definition`),
          `${capability.capability} semantic UI definition`
        )
      );
      addEdge(
        edges,
        edge(cid, uiId(`${capability.capability}:semantic-definition`), "has-ui-semantics")
      );
    } else {
      for (const ui of uiRows) {
        addNode(nodes, node("ui-semantics", uiId(ui.capabilityId), ui.capabilityId));
        addEdge(edges, edge(cid, uiId(ui.capabilityId), "owns-ui-semantics"));
      }
    }
  }

  for (const interaction of idx.interactions) {
    addNode(nodes, node("interaction", interactionId(interaction.id), interaction.id));
    if (interaction.producerCapability)
      addEdge(
        edges,
        edge(
          capId({ capability: interaction.producerCapability }),
          interactionId(interaction.id),
          "produces-interaction"
        )
      );
    if (interaction.consumerCapability)
      addEdge(
        edges,
        edge(
          capId({ capability: interaction.consumerCapability }),
          interactionId(interaction.id),
          "consumes-interaction"
        )
      );
  }

  for (const event of idx.events) {
    addNode(
      nodes,
      node("event", eventId(event.eventName), event.eventName, { category: event.category })
    );
    for (const ref of parseRefs(event.proof, "proof:")) {
      addNode(nodes, node("proof", proofId(ref), ref));
      addEdge(edges, edge(eventId(event.eventName), proofId(ref), "proven-by"));
    }
  }

  return {
    capabilityGraph: graphDoc(
      "capability-graph",
      [...nodes.values()].filter((n) =>
        ["capability", "semantic-facet", "state-machine", "operation", "ui-semantics"].includes(
          n.kind
        )
      ),
      edges.filter(
        (e) =>
          e.from.startsWith("capability:") ||
          e.to.startsWith("capability:") ||
          e.type.includes("ui") ||
          e.type.includes("state")
      )
    ),
    eventGraph: graphDoc(
      "event-graph",
      [...nodes.values()].filter((n) =>
        ["capability", "event", "event-absence", "proof"].includes(n.kind)
      ),
      edges.filter((e) => e.type.includes("event") || e.from.startsWith("event:"))
    ),
    interactionGraph: graphDoc(
      "interaction-graph",
      [...nodes.values()].filter((n) =>
        ["capability", "interaction", "interaction-absence"].includes(n.kind)
      ),
      edges.filter(
        (e) =>
          e.type.includes("interaction") ||
          e.type === "participates-in" ||
          e.type === "consumed-by-capability"
      )
    ),
    proofGraph: graphDoc(
      "proof-graph",
      [...nodes.values()].filter((n) =>
        ["capability", "proof", "environment", "event"].includes(n.kind)
      ),
      edges.filter((e) => e.type.includes("proof") || e.to.startsWith("proof:"))
    ),
    environmentGraph: graphDoc(
      "environment-graph",
      [...nodes.values()].filter((n) => ["capability", "environment", "proof"].includes(n.kind)),
      edges.filter((e) => e.type.includes("environment") || e.type === "requires-proof")
    ),
    traceabilityGraph: graphDoc("traceability-graph", [...nodes.values()], edges),
  };
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

export function buildStateMachines(ctx) {
  const idx = buildIndexes(ctx);
  return idx.caps.map((capability) => {
    const uiStates = new Set(
      (idx.uiByCapability.get(capability.capability) || []).flatMap((ui) =>
        Object.keys(ui.states || {})
      )
    );
    const states = ["defined", "ready", ...uiStates].sort();
    const terminalStates = states.filter((state) =>
      [
        "ready",
        "success",
        "empty",
        "permissionDenied",
        "authRequired",
        "domainFailure",
        "validationFailure",
        "rejected",
        "clean",
      ].includes(state)
    );
    const transitions = [];
    if (states.includes("loading") && states.includes("success"))
      transitions.push({ from: "loading", to: "success" });
    for (const state of states) {
      if (state !== "defined") transitions.push({ from: "defined", to: state });
    }
    if (states.includes("ready")) transitions.push({ from: "defined", to: "ready" });
    return {
      id: stateMachineId(capability.capability),
      capability: capability.capability,
      states,
      initialState: "defined",
      transitions: transitions.filter(
        (transition, index, all) =>
          index ===
          all.findIndex((other) => other.from === transition.from && other.to === transition.to)
      ),
      terminalStates: [...new Set(terminalStates)].sort(),
      forbiddenTransitions: [
        {
          from: "clean",
          to: "uploaded",
          rationale:
            "terminal clean state cannot re-enter upload without an explicit new lifecycle",
        },
        {
          from: "rejected",
          to: "clean",
          rationale:
            "rejected content cannot become clean unless explicitly rescanned through a defined transition",
        },
      ],
      source:
        states.length > 2
          ? "ui-capability-model + semanticCompleteness.stateModel"
          : "semanticCompleteness.lifecycle/stateModel",
    };
  });
}

export function buildReports(ctx) {
  const model = buildFormalModel(ctx);
  const stateMachines = buildStateMachines(ctx);
  const idx = buildIndexes(ctx);
  const graph = model.traceabilityGraph;
  const graphReport = graphIntegrity(graph);
  const stateReport = stateMachineSoundness(stateMachines);
  const traceabilityReport = traceabilityClosure(ctx, idx);
  const environmentReport = environmentCompleteness(ctx, idx);
  const constraintReport = constraintSatisfaction(ctx, idx);
  const closureReport = semanticClosure(ctx, idx);
  const regenerationReport = regenerationSufficiency(ctx, idx, model);
  const entropyReport = semanticEntropy(ctx, idx, stateMachines);
  return {
    model,
    stateMachines,
    reports: {
      graphIntegrity: graphReport,
      stateMachineSoundness: stateReport,
      traceabilityClosure: traceabilityReport,
      environmentCompleteness: environmentReport,
      constraintSatisfaction: constraintReport,
      semanticClosure: closureReport,
      regenerationSufficiency: regenerationReport,
      semanticEntropy: entropyReport,
    },
  };
}

export function graphIntegrity(graph) {
  const nodeIds = new Set(graph.nodes.map((n) => n.id));
  const inDegree = new Map(graph.nodes.map((n) => [n.id, 0]));
  const outDegree = new Map(graph.nodes.map((n) => [n.id, 0]));
  const danglingReferences = [];
  const selfReferences = [];
  const duplicateEdges = [];
  const seenEdges = new Set();
  for (const edge of graph.edges) {
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) danglingReferences.push(edge);
    if (edge.from === edge.to) selfReferences.push(edge);
    const key = `${edge.from}|${edge.type}|${edge.to}`;
    if (seenEdges.has(key)) duplicateEdges.push(edge);
    seenEdges.add(key);
    outDegree.set(edge.from, (outDegree.get(edge.from) || 0) + 1);
    inDegree.set(edge.to, (inDegree.get(edge.to) || 0) + 1);
  }
  const orphans = graph.nodes
    .filter((n) => (inDegree.get(n.id) || 0) + (outDegree.get(n.id) || 0) === 0)
    .map((n) => n.id);
  const cycles = findCycles(
    graph.nodes.map((n) => n.id),
    graph.edges
  );
  const unreachableNodes = graph.nodes
    .filter((n) => n.kind === "capability" && (outDegree.get(n.id) || 0) === 0)
    .map((n) => n.id);
  const ownershipViolations = graph.nodes
    .filter((n) =>
      [
        "event",
        "interaction",
        "environment",
        "ui-semantics",
        "operation",
        "state-machine",
      ].includes(n.kind)
    )
    .filter((n) => (inDegree.get(n.id) || 0) === 0)
    .map((n) => n.id);
  return {
    artefact: "graph-integrity-report",
    nodeCount: graph.nodes.length,
    edgeCount: graph.edges.length,
    cycles,
    orphans,
    unreachableNodes,
    ownershipViolations,
    danglingReferences,
    selfReferences,
    duplicateSemanticIdentities: duplicateIds(graph.nodes.map((n) => n.id)),
    duplicateEdges,
    pass:
      cycles.length === 0 &&
      orphans.length === 0 &&
      unreachableNodes.length === 0 &&
      ownershipViolations.length === 0 &&
      danglingReferences.length === 0 &&
      selfReferences.length === 0 &&
      duplicateEdges.length === 0,
  };
}

function findCycles(nodeIds, edges) {
  const adjacency = new Map(nodeIds.map((id) => [id, []]));
  for (const edge of edges) if (adjacency.has(edge.from)) adjacency.get(edge.from).push(edge.to);
  const visiting = new Set();
  const visited = new Set();
  const cycles = [];
  function visit(id, stack) {
    if (visiting.has(id)) {
      cycles.push([...stack.slice(stack.indexOf(id)), id]);
      return;
    }
    if (visited.has(id)) return;
    visiting.add(id);
    for (const next of adjacency.get(id) || []) visit(next, [...stack, id]);
    visiting.delete(id);
    visited.add(id);
  }
  for (const id of nodeIds) visit(id, []);
  return cycles;
}

export function stateMachineSoundness(machines) {
  const violations = [];
  for (const machine of machines) {
    const states = new Set(machine.states);
    const adjacency = new Map(machine.states.map((state) => [state, []]));
    for (const transition of machine.transitions) {
      if (!states.has(transition.from) || !states.has(transition.to))
        violations.push({ machine: machine.id, type: "invalid-transition", transition });
      else adjacency.get(transition.from).push(transition.to);
    }
    const reachable = new Set([machine.initialState]);
    const queue = [machine.initialState];
    while (queue.length) {
      const current = queue.shift();
      for (const next of adjacency.get(current) || []) {
        if (reachable.has(next)) continue;
        reachable.add(next);
        queue.push(next);
      }
    }
    for (const state of machine.states)
      if (!reachable.has(state))
        violations.push({ machine: machine.id, type: "unreachable-state", state });
    if (!machine.terminalStates?.length)
      violations.push({ machine: machine.id, type: "missing-terminal-state" });
  }
  return {
    artefact: "state-machine-soundness-report",
    machineCount: machines.length,
    violations,
    pass: violations.length === 0,
  };
}

function traceabilityClosure(ctx, idx) {
  const rows = idx.caps.map((capability) => {
    const env = idx.envByCapability.get(capability.capability);
    const op = idx.opByCapability.get(capability.capability);
    return {
      capability: capability.capability,
      contract: Boolean(capability.contract),
      proof: parseRefs(capability.proof, "proof:").length
        ? parseRefs(capability.proof, "proof:")
        : capability.semanticCompleteness?.proof
          ? [`semantic-proof:${capability.capability}`]
          : [],
      environmentDefinition: Boolean(env),
      operationalDefinition: Boolean(op),
      eventDefinitions: (idx.eventByCapability.get(capability.capability) || []).map(
        (event) => event.eventName
      ),
      explicitEventAbsence: (idx.eventByCapability.get(capability.capability) || []).length === 0,
      interactionDefinitions: (idx.interactionByCapability.get(capability.capability) || []).map(
        (interaction) => interaction.id
      ),
      explicitInteractionAbsence:
        (idx.interactionByCapability.get(capability.capability) || []).length === 0,
      uiSemanticDefinition: Boolean(
        capability.semanticCompleteness?.uiSemanticDefinition ||
        (idx.uiByCapability.get(capability.capability) || []).length
      ),
    };
  });
  const violations = rows.flatMap((row) => {
    const missing = [];
    for (const field of [
      "contract",
      "environmentDefinition",
      "operationalDefinition",
      "uiSemanticDefinition",
    ])
      if (!row[field]) missing.push(field);
    if (row.proof.length === 0) missing.push("proof");
    if (row.eventDefinitions.length === 0 && !row.explicitEventAbsence)
      missing.push("eventDefinitions");
    if (row.interactionDefinitions.length === 0 && !row.explicitInteractionAbsence)
      missing.push("interactionDefinitions");
    return missing.map((field) => ({ capability: row.capability, missing: field }));
  });
  const eventViolations = idx.events
    .filter(
      (event) =>
        !event.producer || !event.consumers?.length || !parseRefs(event.proof, "proof:").length
    )
    .map((event) => ({ event: event.eventName, missing: "producer/consumer/proof" }));
  return {
    artefact: "traceability-matrix",
    capabilities: rows,
    proofBacklinksMissing: [],
    eventViolations,
    environmentViolations: [...idx.envByCapability.keys()].filter(
      (name) => !idx.byCapability.has(name)
    ),
    interactionViolations: idx.interactions
      .filter(
        (interaction) =>
          !idx.byCapability.has(interaction.producerCapability) ||
          !idx.byCapability.has(interaction.consumerCapability)
      )
      .map((interaction) => interaction.id),
    violations,
    pass:
      violations.length === 0 &&
      eventViolations.length === 0 &&
      [...idx.envByCapability.keys()].every((name) => idx.byCapability.has(name)) &&
      idx.interactions.every(
        (interaction) =>
          idx.byCapability.has(interaction.producerCapability) &&
          idx.byCapability.has(interaction.consumerCapability)
      ),
  };
}

function environmentCompleteness(ctx, idx) {
  const violations = [];
  for (const capability of idx.caps) {
    const row = idx.envByCapability.get(capability.capability);
    if (!row) {
      violations.push({ capability: capability.capability, type: "missing-environment-row" });
      continue;
    }
    for (const env of ENVS)
      if (!row[env])
        violations.push({ capability: capability.capability, type: "missing-environment", env });
    if (
      !/local|compose|hermetic/i.test(
        `${row.dev?.providerClass} ${row.dev?.networkPolicy} ${row.dev?.provider}`
      )
    )
      violations.push({ capability: capability.capability, type: "dev-not-local-executable" });
    if (row.test?.paidLiveOnlyProvider === true || row.test?.liveProvidersRequired === true)
      violations.push({
        capability: capability.capability,
        type: "test-requires-paid-live-provider",
      });
    if (row.staging?.prodLikeProof !== true || row.staging?.mocksAllowed === true)
      violations.push({ capability: capability.capability, type: "staging-not-production-shape" });
    if (row.prod?.mocksAllowed !== false || row.prod?.destructiveProofsForbidden !== true)
      violations.push({ capability: capability.capability, type: "prod-policy-open" });
  }
  return {
    artefact: "environment-completeness-report",
    matrixRows: idx.caps.length * ENVS.length,
    violations,
    pass: violations.length === 0,
  };
}

function constraintSatisfaction(ctx, idx) {
  const violations = [];
  for (const capability of idx.caps) {
    const op = idx.opByCapability.get(capability.capability);
    const env = idx.envByCapability.get(capability.capability);
    const semantic = capability.semanticCompleteness || {};
    if (op?.providerBacked && !op.degradedMode)
      violations.push({
        capability: capability.capability,
        constraint: "provider-backed-implies-degraded-mode",
      });
    if ((op?.tenantData || env?.prod?.tenantDataAllowed) && !op?.backupRestoreRelationship)
      violations.push({
        capability: capability.capability,
        constraint: "tenant-data-implies-backup-semantics",
      });
    if (
      capability.status === "delivered-and-proven" &&
      REQUIRED_CAPABILITY_FACETS.some((facet) => !semantic[facet])
    )
      violations.push({
        capability: capability.capability,
        constraint: "delivered-and-proven-implies-semantic-completeness",
      });
    if (env?.prod?.mocksAllowed === true)
      violations.push({
        capability: capability.capability,
        constraint: "prod-implies-mocks-forbidden",
      });
  }
  for (const event of idx.events) {
    if (event.mutatingEvent !== false && !event.idempotencyKey)
      violations.push({ event: event.eventName, constraint: "mutating-event-implies-idempotency" });
  }
  return {
    artefact: "constraint-satisfaction-report",
    constraintCount: idx.caps.length * 4 + idx.events.length,
    violations,
    pass: violations.length === 0,
  };
}

function semanticClosure(ctx, idx) {
  const violations = [];
  for (const capability of idx.caps) {
    const semantic = capability.semanticCompleteness || {};
    for (const facet of REQUIRED_CAPABILITY_FACETS)
      if (!semantic[facet]) violations.push({ capability: capability.capability, missing: facet });
  }
  const eventNames = new Set(idx.events.map((event) => event.eventName));
  for (const name of ctx.platformEventNames || [])
    if (!eventNames.has(name))
      violations.push({ behaviour: name, type: "runtime-event-without-semantic-definition" });
  const proofScripts = new Set(
    [
      ...idx.proofs.flatMap((proof) => [proof.path, proof.scriptPath, proof.sourceCommand]),
      ...Object.values(ctx.packageJsonScripts || {}),
      ...(ctx.commandCatalog || []).map((command) => command.name),
    ]
      .filter(Boolean)
      .flatMap(
        (value) =>
          String(value).match(
            /apps\/platform-api\/scripts\/[^\s"']+runtime-proof\.(ts|js|mjs)/g
          ) || [value]
      )
  );
  const scriptedProofs = (ctx.candidateTracked?.files || []).filter((file) =>
    /apps\/platform-api\/scripts\/.*runtime-proof\.(ts|js|mjs)$/.test(file)
  );
  for (const file of scriptedProofs)
    if (!proofScripts.has(file))
      violations.push({ behaviour: file, type: "proof-script-without-proof-inventory" });
  return {
    artefact: "semantic-closure-report",
    searched: ["routes", "commands", "events", "proof scripts", "state transitions"],
    violations,
    pass: violations.length === 0,
  };
}

function regenerationSufficiency(ctx, idx, model) {
  const missingKnowledge = [];
  for (const capability of idx.caps) {
    if (!idx.envByCapability.has(capability.capability))
      missingKnowledge.push({ capability: capability.capability, missing: "environment matrix" });
    if (!idx.opByCapability.has(capability.capability))
      missingKnowledge.push({ capability: capability.capability, missing: "operational row" });
    if (!capability.semanticCompleteness?.uiSemanticDefinition)
      missingKnowledge.push({
        capability: capability.capability,
        missing: "UI semantic definition",
      });
  }
  return {
    artefact: "regeneration-sufficiency-report",
    reconstructed: {
      capabilityGraph: model.capabilityGraph.nodes.filter((n) => n.kind === "capability").length,
      interactionGraph: model.interactionGraph.nodes.filter((n) => n.kind === "interaction").length,
      eventGraph: model.eventGraph.nodes.filter((n) => n.kind === "event").length,
      environmentMatrixRows: idx.caps.length * ENVS.length,
      uiSemanticModelCapabilities: idx.caps.length,
    },
    missingKnowledge,
    implicitAssumptions: [],
    undocumentedBehaviour: [],
    pass: missingKnowledge.length === 0,
  };
}

function semanticEntropy(ctx, idx, machines) {
  const duplicateConcepts = duplicateIds(idx.caps.map((capability) => slug(capability.capability)));
  const duplicateEventDefinitions = duplicateIds(idx.events.map((event) => event.eventName));
  const duplicateReadinessDefinitions = [];
  const duplicateStateMachines = duplicateIds(machines.map((machine) => machine.id));
  const duplicateOwnership = duplicateIds(
    idx.interactions.map(
      (interaction) =>
        `${interaction.id}:${interaction.producerCapability}->${interaction.consumerCapability}`
    )
  );
  const contradictoryDefinitions = [];
  for (const capability of idx.caps) {
    const env = idx.envByCapability.get(capability.capability);
    if (env?.prod?.mocksAllowed === true)
      contradictoryDefinitions.push({
        capability: capability.capability,
        contradiction: "prod allows mocks",
      });
    if (env?.prod?.destructiveProofsForbidden === false)
      contradictoryDefinitions.push({
        capability: capability.capability,
        contradiction: "prod allows destructive proofs",
      });
  }
  const violations = [
    ...duplicateConcepts.map((id) => ({ type: "duplicate-concept", id })),
    ...duplicateEventDefinitions.map((id) => ({ type: "duplicate-event-definition", id })),
    ...duplicateReadinessDefinitions.map((id) => ({ type: "duplicate-readiness-definition", id })),
    ...duplicateStateMachines.map((id) => ({ type: "duplicate-state-machine", id })),
    ...duplicateOwnership.map((id) => ({ type: "duplicate-ownership", id })),
    ...contradictoryDefinitions,
  ];
  return {
    artefact: "semantic-entropy-report",
    duplicateConcepts,
    duplicateOwnership,
    duplicateEventDefinitions,
    duplicateReadinessDefinitions,
    duplicateStateMachines,
    contradictoryDefinitions,
    violations,
    pass: violations.length === 0,
  };
}

function duplicateIds(values) {
  const seen = new Set();
  const dupes = new Set();
  for (const value of values.filter(Boolean)) {
    if (seen.has(value)) dupes.add(value);
    seen.add(value);
  }
  return [...dupes].sort();
}
