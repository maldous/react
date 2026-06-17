#!/usr/bin/env node
// ADR-ACT-0285 Phase 3 — E2E observability-correlation harness.
//
// After an E2E run, prove each scenario is findable in the logs by its
// testRunId/scenarioId (and, when a trace backend is delivered, in Tempo). Writes
// docs/evidence/e2e/<stage>-observability-correlation-latest.{json,md}.
//
// Result/exit contract (shared, result-contract.mjs):
//   FULL     (exit 0) — Loki reachable, a testRunId was provided, ≥1 line carried
//                       it, and any REQUIRED (configured) Tempo backend is reachable.
//   FAILED   (exit 1) — Loki reachable + known testRunId but ZERO matching lines
//                       (scenario logs are not correlatable — a real regression).
//   DEGRADED (exit 2) — could not prove correlation: Loki unreachable, no
//                       E2E_TEST_RUN_ID provided, or a configured Tempo backend is
//                       unreachable. NOT a pass — the stage runner must not promote.
//
// Tempo contract (accurate, not silently ignored): this harness asserts LOG
// correlation (testRunId in Loki) only — it probes Tempo for LIVENESS but does not
// yet correlate a trace by traceId. So Tempo is INFORMATIONAL (recorded, not gating)
// unless an operator opts in with E2E_REQUIRE_TEMPO=1 (set when real trace
// correlation is asserted), in which case an unreachable Tempo makes the result
// DEGRADED (no FULL on Loki alone). The required correlation contract today is Loki.
//
// Env: STAGE, E2E_TEST_RUN_ID (optional), LOKI_QUERY_URL/LOKI_PORT, TEMPO_HTTP_PORT.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { exitCodeForResult } from "../../result-contract.mjs";

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

/**
 * Pure correlation classifier (unit-tested). Drives the result purely from the
 * collected facts so the result→exit mapping is honest and testable.
 *   - Loki unreachable                         → DEGRADED
 *   - no testRunId provided                    → DEGRADED
 *   - testRunId provided, zero lines           → FAILED
 *   - lines > 0 and (Tempo not required OR reachable) → FULL
 *   - lines > 0 but required Tempo unreachable  → DEGRADED
 */
export function classifyCorrelation({
  lokiReachable,
  testRunId,
  lineCount,
  tempoRequired,
  tempoReachable,
}) {
  if (!lokiReachable) return "DEGRADED";
  if (!testRunId) return "DEGRADED";
  if (!(lineCount > 0)) return "FAILED";
  if (tempoRequired && !tempoReachable) return "DEGRADED";
  return "FULL";
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
    `- Tempo: ${payload.tempo.status} (${payload.tempo.required ? "required" : "informational"})${payload.tempo.reason ? ` — ${payload.tempo.reason}` : ""}`,
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

async function main() {
  const report = {
    stage: STAGE,
    testRunId: TEST_RUN_ID,
    result: "DEGRADED",
    loki: { status: "not-checked", reason: null, lineCount: 0 },
    tempo: { status: "not-delivered", required: false, reason: null },
    scenarios: [],
    notes: [],
    generatedFor: "ADR-ACT-0285 Phase 3",
  };

  let lokiReachable = false;

  // --- Loki correlation ---
  try {
    const base = lokiBase();
    const probe = await lokiQuery(base, `{service="platform-api"}`);
    report.loki.status = "reachable";
    lokiReachable = true;
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
        report.loki.reason = `Loki reachable but ZERO lines for testRunId=${TEST_RUN_ID} — scenario logs are not correlatable`;
        report.notes.push(
          "E2E correlation FAILED: no log lines carried this testRunId. Did the run set x-e2e-test-run-id headers (e2e/support/correlation.ts) and is Alloy promoting testRunId to structured metadata?"
        );
      } else {
        report.notes.push(
          `Correlated ${total} log line(s) across ${report.scenarios.length} scenario(s) by testRunId.`
        );
      }
    } else {
      report.loki.reason =
        "no E2E_TEST_RUN_ID provided — pipeline probe only (set E2E_TEST_RUN_ID to correlate a specific run)";
      report.notes.push(`Loki pipeline reachable: ${probe.length} platform-api stream(s) present.`);
    }
  } catch (err) {
    report.loki.status = "unreachable";
    report.loki.reason = String(err.message || err);
    report.notes.push(
      "Loki unreachable — correlation could not be collected. This is honestly DEGRADED, not a pass."
    );
  }

  // --- Tempo (trace backend) ---
  const tb = tempoBase();
  let tempoReachable = false;
  if (!tb) {
    report.tempo.status = "not-configured";
    report.tempo.required = false;
    report.tempo.reason =
      "no TEMPO_HTTP_PORT for this stage — not part of the required contract here";
  } else {
    // Tempo is probed for LIVENESS only — this harness proves LOG correlation
    // (testRunId in Loki); it does not yet assert trace-by-traceId correlation in
    // Tempo. So Tempo is INFORMATIONAL (recorded, not gating) unless an operator
    // explicitly opts in with E2E_REQUIRE_TEMPO=1 (set when real trace correlation
    // is asserted). This is the accurate "not part of the required contract" stance
    // (ADR-ACT-0285) — we don't false-DEGRADE on an un-asserted/undeployed backend.
    report.tempo.required = process.env["E2E_REQUIRE_TEMPO"] === "1";
    try {
      const res = await fetch(`${tb}/ready`, { signal: AbortSignal.timeout(5000) });
      tempoReachable = res.ok;
      report.tempo.status = res.ok ? "reachable" : "unreachable";
      if (!res.ok) report.tempo.reason = `tempo /ready ${res.status}`;
    } catch (err) {
      report.tempo.status = "unreachable";
      report.tempo.reason = String(err.message || err);
    }
  }

  report.result = classifyCorrelation({
    lokiReachable,
    testRunId: TEST_RUN_ID,
    lineCount: report.loki.lineCount,
    tempoRequired: report.tempo.required,
    tempoReachable,
  });
  if (report.result === "DEGRADED" && report.tempo.required && !tempoReachable && lokiReachable) {
    report.notes.push(
      "Required Tempo backend unreachable — DEGRADED even though Loki correlation succeeded (no FULL on Loki alone)."
    );
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
  process.exit(exitCodeForResult(report.result));
}

const invokedDirectly =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) await main();
