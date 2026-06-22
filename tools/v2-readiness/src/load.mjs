import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { AUDIT_BASE_COMMIT } from "./vocab.mjs";

const requireFromHere = createRequire(import.meta.url);
let YAML = null;
try {
  YAML = requireFromHere("yaml");
} catch {
  YAML = null;
}

// Parse compose.yaml services + profiles + top-level volumes (read-only).
function loadCompose(repoRoot) {
  const p = path.join(repoRoot, "compose.yaml");
  if (!YAML || !fs.existsSync(p)) return { services: [], profiles: [], volumes: [], ok: false };
  let doc;
  try {
    doc = YAML.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return { services: [], profiles: [], volumes: [], ok: false };
  }
  const services = Object.entries(doc.services || {}).map(([name, def]) => ({
    name,
    profiles: def.profiles || [],
    image: def.image || null,
    ports: def.ports || [],
  }));
  const profiles = [...new Set(services.flatMap((s) => s.profiles))];
  return { services, profiles, volumes: Object.keys(doc.volumes || {}), ok: true };
}

// On-disk Grafana dashboards + datasource-uid reference counts + V1C-17 proof scripts presence.
// Pure shape returned to the rule (no fs escape hatches inside rules). ADR-0062 + V1C-17b.
function loadV1c17Observability(repoRoot) {
  const dir = path.join(repoRoot, "docker/grafana/dashboards");
  let files = 0;
  let promRefs = 0;
  let lokiRefs = 0;
  let tempoRefs = 0;
  if (fs.existsSync(dir)) {
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith(".json")) continue;
      files++;
      try {
        const doc = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
        const blob = JSON.stringify(doc);
        // Escape-free literal scan: the three provisioning uids are unique strings.
        if (
          blob.includes('"uid":"platform-prometheus"') ||
          blob.includes('"uid": "platform-prometheus"')
        )
          promRefs++;
        if (blob.includes('"uid":"platform-loki"') || blob.includes('"uid": "platform-loki"'))
          lokiRefs++;
        if (blob.includes('"uid":"platform-tempo"') || blob.includes('"uid": "platform-tempo"'))
          tempoRefs++;
      } catch {
        // unparseable dashboard JSON — the rule will flag missing-references anyway
      }
    }
  }
  return {
    files,
    promRefs,
    lokiRefs,
    tempoRefs,
    proofScripts: {
      metricsPrometheusExists: fs.existsSync(
        path.join(repoRoot, "apps/platform-api/scripts/metrics-prometheus-runtime-proof.ts")
      ),
      dashboardsExists: fs.existsSync(
        path.join(repoRoot, "apps/platform-api/scripts/dashboards-runtime-proof.ts")
      ),
    },
  };
}

function loadPlatformEventNames(repoRoot) {
  const files = [
    ...walkFiles(path.join(repoRoot, "apps/platform-api/src")),
    ...walkFiles(path.join(repoRoot, "apps/platform-api/scripts")),
    ...walkFiles(path.join(repoRoot, "apps/platform-api/tests")),
  ].filter((file) => /\.(ts|tsx|mjs|js)$/.test(file));
  const names = new Set();
  const patterns = [
    /eventType:\s*["']([^"']+)["']/g,
    /emitWebhookEvent\(\s*[^,]+,\s*["']([^"']+)["']/g,
    /eventTypes:\s*\[([^\]]+)\]/g,
  ];
  for (const file of files) {
    const text = fs.readFileSync(file, "utf8");
    for (const match of text.matchAll(patterns[0])) names.add(match[1]);
    for (const match of text.matchAll(patterns[1])) names.add(match[1]);
    for (const match of text.matchAll(patterns[2]))
      for (const item of match[1].matchAll(/["']([^"']+)["']/g)) names.add(item[1]);
  }
  return [...names].sort();
}

function walkFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

// On-disk SQL migrations (sequence + filename + checksum).
function loadMigrations(repoRoot) {
  const dir = path.join(repoRoot, "apps/platform-api/src/db/migrations");
  if (!fs.existsSync(dir)) return [];
  const crypto = requireFromHere("node:crypto");
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => ({
      file: f,
      checksum: crypto
        .createHash("sha256")
        .update(fs.readFileSync(path.join(dir, f)))
        .digest("hex")
        .slice(0, 16),
    }));
}

const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const readText = (p) => (fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "");
const readJsonSafe = (p) => {
  try {
    return readJson(p);
  } catch {
    return null;
  }
};

// Parse Make rule heads from Makefile + make/*.mk.
function loadMakeTargets(repoRoot) {
  const files = [path.join(repoRoot, "Makefile")];
  const mkDir = path.join(repoRoot, "make");
  if (fs.existsSync(mkDir))
    for (const f of fs.readdirSync(mkDir)) if (f.endsWith(".mk")) files.push(path.join(mkDir, f));
  const targets = new Set();
  for (const f of files) {
    for (const line of readText(f).split("\n")) {
      const m = /^([a-zA-Z0-9_-]+):/.exec(line);
      if (m && !line.startsWith("\t")) targets.add(m[1]);
    }
  }
  return [...targets];
}

// Set of ADR numeric ids (NNNN) from docs/adr/*.md filenames.
function loadAdrIds(repoRoot) {
  const dir = path.join(repoRoot, "docs/adr");
  const ids = new Set();
  if (fs.existsSync(dir))
    for (const f of fs.readdirSync(dir)) {
      const m = /^(\d{4})-/.exec(f);
      if (m) ids.add(m[1]);
    }
  return ids;
}

// Every ADR-ACT-NNNN id mentioned anywhere in the ADR corpus (the register is sparse; many actions
// are documented only inside ADR bodies). Existence universe for lineage action references.
function loadActionMentions(repoRoot) {
  const dir = path.join(repoRoot, "docs/adr");
  const ids = new Set();
  if (fs.existsSync(dir))
    for (const f of fs.readdirSync(dir))
      if (f.endsWith(".md"))
        for (const m of readText(path.join(dir, f)).matchAll(/ADR-ACT-\d{4}/g)) ids.add(m[0]);
  return ids;
}

// Parse ACTION-REGISTER rows: id -> coarse status (best-effort from the row text).
function loadActionRegister(repoRoot) {
  const txt = readText(path.join(repoRoot, "docs/adr/ACTION-REGISTER.md"));
  const rows = {};
  for (const line of txt.split("\n")) {
    const m = /\|\s*(ADR-ACT-\d{4})\s*\|/.exec(line);
    if (!m) continue;
    let status = "unknown";
    if (/\bDone\b/.test(line)) status = "Done";
    else if (/\bIn Progress\b/i.test(line)) status = "In Progress";
    else if (/\bProposed\b/i.test(line)) status = "Proposed";
    else if (/\bDeferred\b/i.test(line)) status = "Deferred";
    else if (/\bSuperseded\b/i.test(line)) status = "Superseded";
    rows[m[1]] = status;
  }
  return rows;
}

// Files tracked at a commit (read-only). Empty + ok:false if git/commit unavailable.
function loadGitTrackedAtCommit(repoRoot, sha) {
  try {
    const out = execFileSync("git", ["-C", repoRoot, "ls-tree", "-r", "--name-only", sha], {
      encoding: "utf8",
    });
    return { files: out.split("\n").filter(Boolean), ok: true };
  } catch {
    return { files: [], ok: false };
  }
}

const gitOk = (repoRoot, args) => {
  try {
    return execFileSync("git", ["-C", repoRoot, ...args], { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
};

// The cut-candidate file set = the tracked working tree (reflects HEAD on a clean tree, and the
// staged set during preparation). This is what the cut will actually freeze.
function loadCandidateTracked(repoRoot) {
  const out = gitOk(repoRoot, ["ls-files"]);
  return out == null
    ? { files: [], ok: false }
    : { files: out.split("\n").filter(Boolean), ok: true };
}

// Build the validation context from the live repo. Pure rules consume this object;
// tests can also construct a ctx literal directly.
export function loadContext({ repoRoot = process.cwd(), strict = false, pinned } = {}) {
  const D = path.join(repoRoot, "docs/v2-foundation");
  const j = (name) => readJson(path.join(D, name));
  const t = (name) => readText(path.join(D, name));
  const optional = (name) => readJsonSafe(path.join(D, name));
  const optionalFormal = (name) => readJsonSafe(path.join(D, "formal-model", name));
  const pkg = readJson(path.join(repoRoot, "package.json"));

  // inventory shards (docs/v2-foundation/shards/inventory-*.json) concatenated
  const shardsDir = path.join(D, "shards");
  let shards = [];
  if (fs.existsSync(shardsDir))
    for (const f of fs.readdirSync(shardsDir).sort())
      if (/^inventory-\d+\.json$/.test(f))
        shards = shards.concat(readJson(path.join(shardsDir, f)));

  const head = gitOk(repoRoot, ["rev-parse", "HEAD"]);
  const cutCandidateCommit = pinned ?? head ?? AUDIT_BASE_COMMIT;
  const treeClean = gitOk(repoRoot, ["status", "--porcelain"]) === "";

  return {
    repoRoot,
    strict,
    historical: false,
    // two explicit commit concepts (§1)
    auditBaseCommit: AUDIT_BASE_COMMIT,
    cutCandidateCommit,
    headCommit: head,
    treeClean,
    candidateResolves:
      gitOk(repoRoot, ["cat-file", "-e", `${cutCandidateCommit}^{commit}`]) !== null,
    pinnedV1Commit: cutCandidateCommit, // back-compat field name used by older rules/reports
    auditedCommit: AUDIT_BASE_COMMIT,
    // planning artefacts
    pathMap: j("v1-to-v2-path-map.json"),
    fileInventory: j("v1-file-inventory.json"),
    postAuditDelta: optional("v1-post-audit-delta.json"),
    completionActions: optional("v1-completion-actions.json"),
    configConsumption: optional("v1-config-consumption.json"),
    executableAssets: optional("v1-executable-assets.json"),
    envManifests: Object.fromEntries(
      ["common", "dev", "test", "staging", "prod"].map((s) => [
        s,
        readJsonSafe(path.join(repoRoot, `config/environments/${s}.json`)),
      ])
    ),
    shards,
    commandMap: j("v2-command-map.json"),
    commandCatalog: j("v1-command-catalog.json"),
    testMap: j("v2-test-proof-map.json"),
    testInventory: j("v1-test-proof-inventory.json"),
    capabilities: j("v1-capability-closure.json"),
    decisions: j("v2-decision-catalog.json"),
    decisionLineage: j("v2-decision-lineage.json"),
    reconciliation: j("zero-gap-reconciliation.json"),
    directoryContracts: j("v2-directory-contracts.json"),
    targetTree: t("v2-target-tree.txt"),
    gapReport: t("gap-report.md"),
    programme: t("v1-completion-programme.md"),
    runbook: t("v2-branch-cut-runbook.md"),
    // foundation artefacts (shape-checked by R14)
    foundation: {
      "service-and-clickthrough-matrix.json": optional("service-and-clickthrough-matrix.json"),
      "authentication-authorisation-matrix.json": optional(
        "authentication-authorisation-matrix.json"
      ),
      "environment-and-config-catalog.json": optional("environment-and-config-catalog.json"),
      "data-and-migration-plan.json": optional("data-and-migration-plan.json"),
      "v1-knowledge-ledger.json": optional("v1-knowledge-ledger.json"),
      "v2-directory-contracts.json": optional("v2-directory-contracts.json"),
      "ui-definition.schema.json": optional("ui-definition.schema.json"),
      "ui-component-contracts.json": optional("ui-component-contracts.json"),
      "ui-capability-model.json": optional("ui-capability-model.json"),
      "capability-definition.json": optional("capability-definition.json"),
      "capability-state-machine.json": optional("capability-state-machine.json"),
      "capability-permissions.json": optional("capability-permissions.json"),
      "capability-errors.json": optional("capability-errors.json"),
      "capability-ui-contract.json": optional("capability-ui-contract.json"),
      "capability-proof-definition.json": optional("capability-proof-definition.json"),
      "environment-capability-matrix.json": optional("environment-capability-matrix.json"),
      "cross-capability-interactions.json": optional("cross-capability-interactions.json"),
      "event-semantics.json": optional("event-semantics.json"),
      "operational-semantics.json": optional("operational-semantics.json"),
      "semantic-source-of-truth-transition.json": optional(
        "semantic-source-of-truth-transition.json"
      ),
      "environment-readiness-gates.json": optional("environment-readiness-gates.json"),
    },
    formalModel: {
      "capability-graph.json": optionalFormal("capability-graph.json"),
      "event-graph.json": optionalFormal("event-graph.json"),
      "interaction-graph.json": optionalFormal("interaction-graph.json"),
      "proof-graph.json": optionalFormal("proof-graph.json"),
      "environment-graph.json": optionalFormal("environment-graph.json"),
      "traceability-graph.json": optionalFormal("traceability-graph.json"),
      "state-machines.json": optionalFormal("state-machines.json"),
    },
    // live repo facts
    gitTracked: loadGitTrackedAtCommit(repoRoot, AUDIT_BASE_COMMIT),
    candidateTracked: loadCandidateTracked(repoRoot),
    compose: loadCompose(repoRoot),
    caddyfile: readText(path.join(repoRoot, "docker/caddy/Caddyfile")),
    migrations: loadMigrations(repoRoot),
    observabilityV1C17: loadV1c17Observability(repoRoot),
    platformEventNames: loadPlatformEventNames(repoRoot),
    makeTargets: loadMakeTargets(repoRoot),
    adrIds: loadAdrIds(repoRoot),
    actionMentions: loadActionMentions(repoRoot),
    actionRegister: loadActionRegister(repoRoot),
    packageJsonScripts: pkg.scripts || {},
    listTestFiles: () => {
      try {
        const out = execFileSync(
          "git",
          [
            "-C",
            repoRoot,
            "ls-files",
            "*.test.ts",
            "*.test.tsx",
            "*.test.mjs",
            "*.test.js",
            "*.spec.ts",
            "*.spec.tsx",
          ],
          { encoding: "utf8" }
        );
        return out.split("\n").filter(Boolean);
      } catch {
        return null;
      }
    },
    fileExists: (rel) => fs.existsSync(path.join(repoRoot, rel)),
    toolIndexExists: fs.existsSync(path.join(repoRoot, "tools/v2-readiness/src/index.mjs")),
  };
}
