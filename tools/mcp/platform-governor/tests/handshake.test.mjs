#!/usr/bin/env node
// Self-test: spawn the MCP server, perform the initialize handshake, list tools,
// and call a few read-only tools. Exits non-zero on any failure.
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert";

const here = path.dirname(fileURLToPath(import.meta.url));
const server = path.join(here, "..", "src", "index.mjs");
const repoRoot = path.resolve(here, "..", "..", "..", "..");

const child = spawn("node", [server], {
  cwd: repoRoot,
  env: { ...process.env, CONTROL_REPO_ROOT: repoRoot },
  stdio: ["pipe", "pipe", "inherit"],
});

const pending = new Map();
let buf = "";
child.stdout.on("data", (d) => {
  buf += d.toString();
  let nl;
  while ((nl = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    const msg = JSON.parse(line);
    if (msg.id !== undefined && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  }
});

let nextId = 1;
function rpc(method, params) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout on ${method}`)), 60000);
    pending.set(id, (m) => {
      clearTimeout(t);
      resolve(m);
    });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
}
function notify(method, params) {
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
}

function parseToolResult(res) {
  assert.ok(res.result, "tool returned a result");
  return JSON.parse(res.result.content[0].text);
}

async function main() {
  const init = await rpc("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "selftest", version: "0" },
  });
  assert.equal(init.result.serverInfo.name, "platform-governor", "serverInfo.name");
  assert.ok(init.result.capabilities.tools, "advertises tools capability");
  notify("notifications/initialized");

  const list = await rpc("tools/list");
  const names = list.result.tools.map((t) => t.name);
  for (const expected of [
    "list_adrs",
    "get_action_status",
    "validate_action_register",
    "run_architecture_gates",
    "list_evidence",
    "map_capabilities",
    "map_contracts_routes_usecases",
    "run_proof_script",
  ]) {
    assert.ok(names.includes(expected), `tools/list includes ${expected}`);
  }

  const adrs = parseToolResult(await rpc("tools/call", { name: "list_adrs", arguments: {} }));
  assert.ok(adrs.count >= 40, `list_adrs found ${adrs.count} ADRs`);

  const status = parseToolResult(
    await rpc("tools/call", { name: "get_action_status", arguments: { status: "Done" } })
  );
  assert.ok(status.matched >= 1, `get_action_status Done matched ${status.matched}`);
  assert.ok(status.byStatus, "byStatus present");

  const ev = parseToolResult(
    await rpc("tools/call", { name: "list_evidence", arguments: { area: "platform" } })
  );
  assert.ok(ev.count >= 1, `list_evidence platform found ${ev.count}`);

  const caps = parseToolResult(
    await rpc("tools/call", { name: "map_capabilities", arguments: {} })
  );
  assert.ok(caps.count >= 5, `map_capabilities found ${caps.count}`);

  const map = parseToolResult(
    await rpc("tools/call", { name: "map_contracts_routes_usecases", arguments: {} })
  );
  assert.ok(map.counts.contracts >= 4, `contracts mapped ${map.counts.contracts}`);

  const vreg = parseToolResult(
    await rpc("tools/call", { name: "validate_action_register", arguments: {} })
  );
  assert.ok(typeof vreg.ok === "boolean", "validate_action_register returned ok flag");

  const bad = await rpc("tools/call", { name: "run_proof_script", arguments: { name: "rm-rf" } });
  const badOut = JSON.parse(bad.result.content[0].text);
  assert.ok(badOut.error && /allowlist/.test(badOut.error), "proof allowlist enforced");

  console.log(
    `PASS — handshake + ${names.length} tools; ${adrs.count} ADRs, ${status.total} action rows, ${caps.count} capabilities, ${map.counts.contracts} contracts.`
  );
  child.stdin.end();
  process.exit(0);
}

main().catch((e) => {
  console.error("FAIL:", e.message);
  child.kill();
  process.exit(1);
});
