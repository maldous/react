#!/usr/bin/env node
// ADR-ACT-0285 Phase 3 — E2E observability-correlation harness.
//
// After an E2E run, prove each scenario is findable in the logs by its
// testRunId/scenarioId (and, when a trace backend is delivered, in Tempo). Writes
// docs/evidence/e2e/<stage>-observability-correlation-latest.{json,md}.
//
// Honesty: if Loki/Tempo are unreachable, the report records DEGRADED with the
// reason — it never silently claims correlation that wasn't collected. A real
// correlation FAILURE (Loki reachable, a known testRunId, but zero matching lines)
// exits 1. Missing backends / no testRunId → DEGRADED, exit 0 (nothing to prove
// yet). Pure Node + fetch; no app runtime.
//
// Env: STAGE, E2E_TEST_RUN_ID (optional), LOKI_URL or LOKI host port via the
// generated .env/<stage>.env, TEMPO_HTTP_PORT (optional).

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import process from "node:process";

const ROOT = resolve(".");
const STAGE = (process.env["STAGE"] || process.env["E2E_STAGE"] || "local").toLowerCase();
const TEST_RUN_ID = process.env["E2E_TEST_RUN_ID"] || "";
const EVIDENCE_DIR = join(ROOT, "docs/evidence/e2e");

function envValue(key) {
  const f = join(ROOT, ".env", `${STAGE}.env`);
  if (!existsSync(f)) return undefined;
  const m = new RegExp(`^${key}=(.*)$`, "m").exec(readFileSync(f, "utf8"));
  return m ? m[1].replace(/^["']|["']$/g, "") : undefined;
}

function lokiBase() {
  if (process.env["LOKI_QUERY_URL"]) return process.env["LOKI_QUERY_URL"];
  const port = envValue("LOKI_PORT") || "3100";
  return `http://localhost:${port}`;
}

function tempoBase() {
  const port = envValue("TEMPO_HTTP_PORT");
  return port ? `http://localhost:${port}` : null;
}

async function lokiQuery(base, query) {
  const end = `${Date.now()}000000`;
  const start = `${Date.now() - 15 * 60 * 1000}000000`;
  const u = new URL(`${base}/loki/api/v1/query_range`);
  u.searchParams.set("query", query);
  u.searchParams.set("start", start);
  u.searchParams.set("end", end);
  u.searchParams.set("limit", "200");
  const res = await fetch(u, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`loki ${res.status}`);
  const json = await res.json();
  return json.data?.result ?? [];
}

function writeReport(payload) {
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  const base = join(EVIDENCE_DIR, `${STAGE}-observability-correlation-latest`);
  writeFileSync(`${base}.json`, JSON.stringify(payload, null, 2) + "\n");
  const md = [
    `# E2E observability correlation — ${STAGE}`,
    "",
    "Generated (ADR-ACT-0285 Phase 3). DO NOT EDIT — regenerate via the e2e-observability-correlation make target.",
    "",
    `- Result: **${payload.result}**`,
    `- testRunId: \`${payload.testRunId || "(none provided)"}\``,
    `- Loki: ${payload.loki.status}${payload.loki.reason ? ` — ${payload.loki.reason}` : ""}`,
    `- Tempo: ${payload.tempo.status}${payload.tempo.reason ? ` — ${payload.tempo.reason}` : ""}`,
    `- Log lines correlated: ${payload.loki.lineCount}`,
    `- Scenarios seen: ${payload.scenarios.length}`,
    "",
  ];
  if (payload.scenarios.length) {
    md.push("## Scenarios correlated in Loki", "");
    for (const s of payload.scenarios) md.push(`- \`${s.scenarioId}\`: ${s.lines} line(s)`);
    md.push("");
  }
  if (payload.notes.length) {
    md.push("## Notes", "");
    for (const n of payload.notes) md.push(`- ${n}`);
    md.push("");
  }
  writeFileSync(`${base}.md`, md.join("\n"));
}

const report = {
  stage: STAGE,
  testRunId: TEST_RUN_ID,
  result: "DEGRADED",
  loki: { status: "not-checked", reason: null, lineCount: 0 },
  tempo: { status: "not-delivered", reason: null },
  scenarios: [],
  notes: [],
  generatedFor: "ADR-ACT-0285 Phase 3",
};

let exitCode = 0;

// --- Loki correlation ---
try {
  const base = lokiBase();
  // Prove the platform-api log pipeline is queryable at all.
  const probe = await lokiQuery(base, `{service="platform-api"}`);
  report.loki.status = "reachable";
  if (TEST_RUN_ID) {
    const result = await lokiQuery(
      base,
      `{service="platform-api"} | json | testRunId=\`${TEST_RUN_ID}\``
    );
    const byScenario = new Map();
    let total = 0;
    for (const stream of result) {
      const sid = stream.stream?.scenarioId || stream.stream?.detected_scenarioId || "unknown";
      const n = stream.values?.length ?? 0;
      total += n;
      byScenario.set(sid, (byScenario.get(sid) ?? 0) + n);
    }
    report.loki.lineCount = total;
    report.scenarios = [...byScenario.entries()].map(([scenarioId, lines]) => ({
      scenarioId,
      lines,
    }));
    if (total === 0) {
      report.result = "FAILED";
      report.loki.reason = `Loki reachable but ZERO lines for testRunId=${TEST_RUN_ID} — scenario logs are not correlatable`;
      report.notes.push(
        "E2E correlation FAILED: no log lines carried this testRunId. Did the run set x-e2e-test-run-id headers (e2e/support/correlation.ts) and is Alloy promoting testRunId to structured metadata?"
      );
      exitCode = 1;
    } else {
      report.result = "FULL";
      report.notes.push(
        `Correlated ${total} log line(s) across ${report.scenarios.length} scenario(s) by testRunId.`
      );
    }
  } else {
    report.result = "DEGRADED";
    report.loki.reason =
      "no E2E_TEST_RUN_ID provided — pipeline probe only (set E2E_TEST_RUN_ID to correlate a specific run)";
    report.notes.push(`Loki pipeline reachable: ${probe.length} platform-api stream(s) present.`);
  }
} catch (err) {
  report.loki.status = "unreachable";
  report.loki.reason = String(err.message || err);
  report.result = "DEGRADED";
  report.notes.push(
    "Loki unreachable — correlation could not be collected. This is honestly DEGRADED, not a pass."
  );
}

// --- Tempo (trace backend) ---
const tb = tempoBase();
if (!tb) {
  report.tempo.status = "not-configured";
  report.tempo.reason = "no TEMPO_HTTP_PORT for this stage";
} else {
  try {
    const res = await fetch(`${tb}/ready`, { signal: AbortSignal.timeout(5000) });
    report.tempo.status = res.ok ? "reachable" : "degraded";
    if (!res.ok) report.tempo.reason = `tempo /ready ${res.status}`;
  } catch (err) {
    report.tempo.status = "unreachable";
    report.tempo.reason = String(err.message || err);
  }
}

writeReport(report);
const tag =
  report.result === "FULL"
    ? "\x1b[32m✓\x1b[0m"
    : report.result === "FAILED"
      ? "\x1b[31m✗\x1b[0m"
      : "\x1b[33m⚠\x1b[0m";
console.log(
  `${tag} e2e observability-correlation: ${report.result} — Loki ${report.loki.status} (${report.loki.lineCount} lines), Tempo ${report.tempo.status} → docs/evidence/e2e/${STAGE}-observability-correlation-latest.md`
);
process.exit(exitCode);
