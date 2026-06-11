#!/usr/bin/env node
// platform-governor — local MCP server exposing this repo's native governance tools.
//
// Design constraints (see docs/evidence/tooling/claude-code-optimisation-review.md):
//   - Local only. No network. No secrets. Read-mostly: the only "writes" are running
//     existing repo scripts as the operator would.
//   - All child processes use fixed argv arrays; tool inputs are validated against
//     allowlists, never interpolated into a shell.
//   - Transport: JSON-RPC 2.0 over newline-delimited stdio (MCP stdio transport).
//
// It implements the MCP methods Claude Code needs: initialize, tools/list, tools/call, ping.

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { spawnSync } from "node:child_process";
import process from "node:process";

const SERVER_NAME = "platform-governor";
const SERVER_VERSION = "0.1.0";
const DEFAULT_PROTOCOL = "2024-11-05";
const MAX_OUTPUT = 20000;

const REPO_ROOT = process.env.CONTROL_REPO_ROOT || process.cwd();

// --------------------------------------------------------------------------
// stderr logging (stdout is reserved for protocol messages)
// --------------------------------------------------------------------------
const logErr = (...a) => process.stderr.write(`[platform-governor] ${a.join(" ")}\n`);

function truncate(s) {
  if (typeof s !== "string") s = String(s);
  return s.length > MAX_OUTPUT
    ? s.slice(0, MAX_OUTPUT) + `\n…[truncated ${s.length - MAX_OUTPUT} chars]`
    : s;
}

function repoPath(...p) {
  return path.join(REPO_ROOT, ...p);
}

function readIfExists(p) {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return null;
  }
}

// Run a fixed command (no shell). args is an array. Returns {ok, code, stdout, stderr}.
function run(cmd, args, { timeout = 180000 } = {}) {
  const r = spawnSync(cmd, args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    timeout,
    maxBuffer: 32 * 1024 * 1024,
    shell: false,
  });
  return {
    ok: r.status === 0,
    code: r.status,
    stdout: truncate(r.stdout || ""),
    stderr: truncate(r.stderr || ""),
    error: r.error ? String(r.error.message || r.error) : null,
  };
}

// --------------------------------------------------------------------------
// Governance parsers
// --------------------------------------------------------------------------
function listAdrs() {
  const dir = repoPath("docs/adr");
  let files;
  try {
    files = fs.readdirSync(dir).filter((f) => /^\d{4}-.*\.md$/.test(f) && f !== "0000-template.md");
  } catch (e) {
    return { error: `cannot read ${dir}: ${e.message}` };
  }
  const adrs = files.sort().map((f) => {
    const text = readIfExists(path.join(dir, f)) || "";
    const titleLine = text.split("\n").find((l) => l.startsWith("# "));
    const title = titleLine ? titleLine.replace(/^#\s+/, "").trim() : f;
    // status: first non-empty line after a "## Status" heading
    let status = "unknown";
    const lines = text.split("\n");
    const si = lines.findIndex((l) => /^#{1,3}\s+status\b/i.test(l));
    if (si >= 0) {
      for (let i = si + 1; i < lines.length; i++) {
        const v = lines[i].trim();
        if (v) {
          status = v.replace(/[*_`]/g, "");
          break;
        }
      }
    }
    const id = f.match(/^(\d{4})/)[1];
    return { id: `ADR-${id}`, file: `docs/adr/${f}`, title, status };
  });
  return { count: adrs.length, adrs };
}

function parseActionRegister() {
  const text = readIfExists(repoPath("docs/adr/ACTION-REGISTER.md"));
  if (!text) return { error: "ACTION-REGISTER.md not found" };
  const cols = [
    "id",
    "sourceAdr",
    "action",
    "type",
    "status",
    "priority",
    "dependsOn",
    "owner",
    "target",
    "evidence",
  ];
  const rows = [];
  for (const line of text.split("\n")) {
    if (!/^\|\s*ADR-ACT-\d+/.test(line)) continue;
    const cells = line
      .split("|")
      .slice(1, -1)
      .map((c) => c.trim());
    if (cells.length < cols.length) continue;
    const row = {};
    cols.forEach((k, i) => (row[k] = cells[i]));
    row.action = truncate(row.action).slice(0, 240);
    rows.push(row);
  }
  return { count: rows.length, rows };
}

function getActionStatus({ id, status } = {}) {
  const parsed = parseActionRegister();
  if (parsed.error) return parsed;
  let rows = parsed.rows;
  if (id) rows = rows.filter((r) => r.id.toLowerCase() === String(id).toLowerCase());
  if (status) rows = rows.filter((r) => r.status.toLowerCase() === String(status).toLowerCase());
  const byStatus = {};
  for (const r of parsed.rows) byStatus[r.status] = (byStatus[r.status] || 0) + 1;
  return { total: parsed.count, byStatus, matched: rows.length, rows };
}

function listEvidence({ area } = {}) {
  const base = repoPath("docs/evidence");
  const out = [];
  const walk = (dir, rel) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(path.join(dir, e.name), r);
      else if (e.name.endsWith(".md") && e.name !== "README.md") out.push(`docs/evidence/${r}`);
    }
  };
  if (area) walk(path.join(base, area), area);
  else walk(base, "");
  return { count: out.length, files: out.sort() };
}

function mapCapabilities() {
  const text = readIfExists(
    repoPath("docs/evidence/platform/enterprise-control-plane-capability-map.md")
  );
  if (!text) return { error: "capability-map evidence not found" };
  const rows = [];
  let inTable = false;
  for (const line of text.split("\n")) {
    if (/^\|\s*Capability\s*\|/.test(line)) {
      inTable = true;
      continue;
    }
    if (inTable && /^\|\s*-{2,}/.test(line)) continue;
    if (inTable) {
      if (!line.startsWith("|")) {
        inTable = false;
        continue;
      }
      const c = line
        .split("|")
        .slice(1, -1)
        .map((x) => x.trim());
      if (c.length >= 6)
        rows.push({
          capability: c[0],
          category: c[1],
          adminRoute: c[2],
          impl: c[3],
          required: c[4] === "✓",
          readinessSource: c[5],
        });
    }
  }
  return {
    source: "docs/evidence/platform/enterprise-control-plane-capability-map.md",
    count: rows.length,
    capabilities: rows,
  };
}

function mapContractsRoutesUsecases() {
  const result = { contracts: [], routes: [], usecases: [] };
  try {
    result.contracts = fs
      .readdirSync(repoPath("packages"))
      .filter((d) => d.startsWith("contracts-"));
  } catch {
    /* ignore */
  }
  const apiSrc = repoPath("apps/platform-api/src");
  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (/\.ts$/.test(e.name)) {
        const rel = path.relative(REPO_ROOT, full);
        if (/route/i.test(e.name)) result.routes.push(rel);
        if (/(usecase|use-case)/i.test(e.name)) result.usecases.push(rel);
      }
    }
  };
  walk(apiSrc);
  return {
    contracts: result.contracts.sort(),
    routeFiles: result.routes.sort(),
    usecaseFiles: result.usecases.sort(),
    counts: {
      contracts: result.contracts.length,
      routeFiles: result.routes.length,
      usecaseFiles: result.usecases.length,
    },
  };
}

function validateActionRegister() {
  return run("node", ["tools/architecture/validate-action-register/src/index.mjs"], {
    timeout: 120000,
  });
}

const GATE_COMMANDS = new Set(["validate", "all", "validate-evidence", "generate-inventory"]);
function runArchitectureGates({ command = "validate" } = {}) {
  if (!GATE_COMMANDS.has(command)) {
    return { error: `command must be one of ${[...GATE_COMMANDS].join(", ")}` };
  }
  return run(
    "node",
    ["tools/architecture/orchestrator/src/index.mjs", command, "--no-reports", "--strict"],
    { timeout: 300000 }
  );
}

const PROOF_SCRIPTS = new Set([
  "proof:auth-settings",
  "proof:auth-idps",
  "proof:auth-credential-lifecycle",
]);
function runProofScript({ name } = {}) {
  if (!PROOF_SCRIPTS.has(name)) {
    return { error: `name must be one of ${[...PROOF_SCRIPTS].join(", ")} (allowlist)` };
  }
  const r = run("npm", ["run", "--silent", name], { timeout: 240000 });
  return {
    ...r,
    note: "Requires local services (Keycloak) up. A failure here may mean services are down, not a code defect.",
  };
}

// --------------------------------------------------------------------------
// Tool registry
// --------------------------------------------------------------------------
const TOOLS = [
  {
    name: "list_adrs",
    description: "List all ADRs (docs/adr/*.md) with id, title, and Status. Read-only.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    handler: () => listAdrs(),
  },
  {
    name: "get_action_status",
    description:
      "Query ACTION-REGISTER.md rows. Optional filters: id (e.g. ADR-ACT-0213) and/or status (Open|In Progress|Blocked|Done|Deferred|Superseded). Returns counts by status and matched rows. Read-only.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" }, status: { type: "string" } },
      additionalProperties: false,
    },
    handler: (a) => getActionStatus(a),
  },
  {
    name: "validate_action_register",
    description:
      "Run the repo's action-register validator (tools/architecture/validate-action-register). Read-only check.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    handler: () => validateActionRegister(),
  },
  {
    name: "run_architecture_gates",
    description:
      "Run the architecture orchestrator. command: 'validate' (fast, metadata only — default), 'all', 'validate-evidence', or 'generate-inventory'. Runs with --no-reports --strict. May take time.",
    inputSchema: {
      type: "object",
      properties: {
        command: {
          type: "string",
          enum: ["validate", "all", "validate-evidence", "generate-inventory"],
        },
      },
      additionalProperties: false,
    },
    handler: (a) => runArchitectureGates(a),
  },
  {
    name: "list_evidence",
    description:
      "List committed evidence files under docs/evidence. Optional 'area' (e.g. auth, platform, admin). Read-only.",
    inputSchema: {
      type: "object",
      properties: { area: { type: "string" } },
      additionalProperties: false,
    },
    handler: (a) => listEvidence(a),
  },
  {
    name: "map_capabilities",
    description:
      "Return the enterprise capability matrix (capability, category, admin route, impl status, required, readiness source) from the capability-map evidence. Read-only.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    handler: () => mapCapabilities(),
  },
  {
    name: "map_contracts_routes_usecases",
    description:
      "Map contract packages and platform-api route/usecase files. Read-only structural map.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    handler: () => mapContractsRoutesUsecases(),
  },
  {
    name: "run_proof_script",
    description:
      "Run an allowlisted live proof script. name: proof:auth-settings | proof:auth-idps | proof:auth-credential-lifecycle. Requires local services (Keycloak) running.",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          enum: ["proof:auth-settings", "proof:auth-idps", "proof:auth-credential-lifecycle"],
        },
      },
      required: ["name"],
      additionalProperties: false,
    },
    handler: (a) => runProofScript(a),
  },
];

const TOOL_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

// --------------------------------------------------------------------------
// JSON-RPC plumbing
// --------------------------------------------------------------------------
function send(msg) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

function reply(id, result) {
  send({ jsonrpc: "2.0", id, result });
}

function replyError(id, code, message) {
  send({ jsonrpc: "2.0", id, error: { code, message } });
}

function handle(msg) {
  const { id, method, params } = msg;
  const isNotification = id === undefined || id === null;

  switch (method) {
    case "initialize": {
      const protocolVersion = (params && params.protocolVersion) || DEFAULT_PROTOCOL;
      return reply(id, {
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
      });
    }
    case "notifications/initialized":
    case "initialized":
      return; // notification, no response
    case "ping":
      return reply(id, {});
    case "tools/list":
      return reply(id, {
        tools: TOOLS.map(({ name, description, inputSchema }) => ({
          name,
          description,
          inputSchema,
        })),
      });
    case "tools/call": {
      const name = params && params.name;
      const tool = TOOL_BY_NAME.get(name);
      if (!tool) return replyError(id, -32602, `Unknown tool: ${name}`);
      try {
        const out = tool.handler((params && params.arguments) || {});
        const isError = out && typeof out === "object" && out.error ? true : false;
        return reply(id, {
          content: [
            { type: "text", text: typeof out === "string" ? out : JSON.stringify(out, null, 2) },
          ],
          isError,
        });
      } catch (e) {
        return reply(id, {
          content: [{ type: "text", text: `Tool error: ${e.message}` }],
          isError: true,
        });
      }
    }
    default:
      if (isNotification) return;
      return replyError(id, -32601, `Method not found: ${method}`);
  }
}

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let msg;
  try {
    msg = JSON.parse(trimmed);
  } catch {
    logErr("failed to parse line as JSON");
    return;
  }
  try {
    handle(msg);
  } catch (e) {
    logErr("handler threw:", e.message);
    if (msg && msg.id !== undefined && msg.id !== null)
      replyError(msg.id, -32603, `Internal error: ${e.message}`);
  }
});
rl.on("close", () => process.exit(0));

logErr(`ready — repo root ${REPO_ROOT}, ${TOOLS.length} tools`);
