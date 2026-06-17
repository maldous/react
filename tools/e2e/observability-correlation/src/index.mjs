#!/usr/bin/env node
// ADR-ACT-0285 Phase 3 + closure — E2E observability-correlation harness.
//
// After an E2E run, prove that EVERY manifest scenario REQUIRED for this stage was
// actually observed in Loki (per-scenario, no truncation blind spot), and that the
// scenarios declaring expectedTraces are retrievable BY TRACE ID in Tempo with the
// expected service/span contract. Writes
// docs/evidence/e2e/<stage>-observability-correlation-latest.{json,md}.
//
// Result/exit contract (shared, result-contract.mjs):
//   FULL     (exit 0) — every REQUIRED log scenario observed AND every REQUIRED trace
//                       matched in Tempo (service/span contract, no leaked secrets).
//   FAILED   (exit 1) — a REQUIRED scenario produced ZERO correlatable lines, OR a Loki
//                       line exists but its trace is missing in Tempo after polling, OR a
//                       trace exists but a required service/span is absent (or a secret leaked).
//   DEGRADED (exit 2) — could not prove correlation: Loki unreachable, no E2E_TEST_RUN_ID,
//                       the probe could not be emitted, or a REQUIRED Tempo backend is
//                       unreachable/not configured. NOT a pass — never promotes.
//
// The synthetic pipeline-health probe (an unauthenticated denial) is itself a manifest
// scenario (pipeline-health-probe); it proves the header->log->Loki->Tempo pipeline is
// alive but does NOT substitute for the real scenarios — those are required in their own right.
//
// Env: STAGE, E2E_TEST_RUN_ID, LOKI_QUERY_URL/LOKI_PORT, TEMPO_HTTP_PORT,
//      TEMPO_POLL_ATTEMPTS, TEMPO_POLL_INTERVAL_MS, OBS_CORR_INGEST_WAIT_MS.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { exitCodeForResult, worstResult } from "../../result-contract.mjs";
import {
  loadModel,
  expand,
  scenariosForStage,
  requiredLogScenarioIds,
  requiredTraceScenarios,
  logRequirementForStage,
} from "../../scenario-manifest.mjs";
import {
  parseTraceId,
  pollTempoTrace,
  extractSpans,
  assertTraceContract,
} from "../../tempo-trace.mjs";

const ROOT = resolve(".");
const STAGE = (process.env["STAGE"] || process.env["E2E_STAGE"] || "local").toLowerCase();
const TEST_RUN_ID = process.env["E2E_TEST_RUN_ID"] || "";
const EVIDENCE_DIR = join(ROOT, "docs/evidence/e2e");
const PROBE_SCENARIO = "pipeline-health-probe";

function envValue(key) {
  const f = join(ROOT, ".env", `${STAGE}.env`);
  if (!existsSync(f)) return undefined;
  const m = new RegExp(`^${key}=(.*)$`, "m").exec(readFileSync(f, "utf8"));
  return m ? m[1].replace(/^["']|["']$/g, "") : undefined;
}

function lokiBase() {
  if (process.env["LOKI_QUERY_URL"]) return process.env["LOKI_QUERY_URL"];
  return `http://localhost:${envValue("LOKI_PORT") || "3100"}`;
}
function apiBase() {
  if (process.env["OBS_CORR_API_URL"]) return process.env["OBS_CORR_API_URL"];
  return `http://localhost:${envValue("PLATFORM_API_PORT") || "3001"}`;
}
function tempoBase() {
  if (process.env["TEMPO_QUERY_URL"]) return process.env["TEMPO_QUERY_URL"];
  const port = process.env["TEMPO_HTTP_PORT"] || envValue("TEMPO_HTTP_PORT");
  return port ? `http://localhost:${port}` : null;
}

/** Emit ONE deterministic correlatable denial (unauthenticated GET to a protected
 *  route → http.request.rejected WARN carrying testRunId+scenarioId). Reliable
 *  regardless of LOG_LEVEL. Returns true if the request reached the BFF. */
async function emitProbeDenial() {
  if (!TEST_RUN_ID) return false;
  try {
    await fetch(`${apiBase()}/api/admin/tenants`, {
      headers: {
        "x-e2e-test-run-id": TEST_RUN_ID,
        "x-e2e-scenario-id": PROBE_SCENARIO,
        "x-e2e-stage": STAGE,
      },
      signal: AbortSignal.timeout(8000),
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Query Loki for ALL lines matching `query`, paginating backward so there is NO fixed
 * truncation blind spot. Returns { lines: [{ts, line}], truncated }. `truncated` is true
 * only if the safety cap (maxPages) was hit — surfaced honestly in evidence.
 */
export async function lokiQueryAll(base, query, opts = {}) {
  const windowMs = opts.windowMs ?? 30 * 60 * 1000;
  const perPage = opts.perPage ?? 1000;
  const maxPages = opts.maxPages ?? 50;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const now = opts.nowMs ?? Date.now();
  let endNs = BigInt(now) * 1_000_000n;
  const startNs = BigInt(now - windowMs) * 1_000_000n;
  const seen = new Set();
  const lines = [];
  let truncated = false;
  for (let page = 0; page < maxPages; page++) {
    const u = new URL(`${base}/loki/api/v1/query_range`);
    u.searchParams.set("query", query);
    u.searchParams.set("start", startNs.toString());
    u.searchParams.set("end", endNs.toString());
    u.searchParams.set("limit", String(perPage));
    u.searchParams.set("direction", "backward");
    const res = await fetchImpl(u, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`loki ${res.status}`);
    const json = await res.json();
    const streams = json.data?.result ?? [];
    let pageCount = 0;
    let oldestNs = endNs;
    for (const stream of streams) {
      for (const [ts, line] of stream.values ?? []) {
        const key = `${ts}:${line}`;
        const tsNs = BigInt(ts);
        if (tsNs < oldestNs) oldestNs = tsNs;
        if (seen.has(key)) continue;
        seen.add(key);
        lines.push({ ts, line });
        pageCount++;
      }
    }
    if (pageCount < perPage) break; // exhausted
    if (page === maxPages - 1) {
      truncated = true;
      break;
    }
    endNs = oldestNs - 1n; // continue older than the oldest line seen
  }
  return { lines, truncated };
}

/** Group Loki lines by scenarioId, collecting line count + the distinct traceIds. */
export function groupByScenario(lines) {
  const map = new Map();
  for (const { line } of lines) {
    let sid = "unknown";
    let traceId = null;
    try {
      const o = JSON.parse(line);
      if (o.scenarioId) sid = o.scenarioId;
      if (o.traceId) traceId = o.traceId;
    } catch {
      /* non-json line */
    }
    if (!map.has(sid)) map.set(sid, { lines: 0, traceIds: new Set() });
    const e = map.get(sid);
    e.lines++;
    if (traceId) e.traceIds.add(traceId);
  }
  return map;
}

/**
 * Compute per-scenario completeness from the expected stage scenarios and the observed
 * Loki groups. Pure + unit-tested.
 * Returns { perScenario:[{scenarioId,required,observed,lines,traceIds,result}],
 *           missingRequired:[], unexpected:[], result }.
 */
export function computeCompleteness(stageScenarios, stage, observedMap) {
  const knownIds = new Set(stageScenarios.map((s) => s.scenarioId));
  const perScenario = [];
  const missingRequired = [];
  for (const s of stageScenarios) {
    const req = logRequirementForStage(s, stage) === "required";
    const o = observedMap.get(s.scenarioId);
    const observed = Boolean(o);
    let result;
    if (req && !observed) {
      result = "MISSING";
      missingRequired.push(s.scenarioId);
    } else if (req) result = "OK";
    else result = observed ? "OBSERVED" : "ABSENT";
    perScenario.push({
      scenarioId: s.scenarioId,
      required: req,
      observed,
      lines: o ? o.lines : 0,
      traceIds: o ? [...o.traceIds] : [],
      result,
    });
  }
  const unexpected = [...observedMap.keys()].filter((id) => !knownIds.has(id));
  const result = missingRequired.length ? "FAILED" : "PASSED";
  return { perScenario, missingRequired, unexpected, result };
}

function writeReport(payload) {
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  const base = join(EVIDENCE_DIR, `${STAGE}-observability-correlation-latest`);
  writeFileSync(`${base}.json`, JSON.stringify(payload, null, 2) + "\n");
  const md = [
    `# E2E observability correlation — ${STAGE}`,
    "",
    "Generated (ADR-ACT-0285 Phase 3 + closure). DO NOT EDIT — regenerate via the e2e-observability-correlation make target.",
    "",
    `- Result: **${payload.result}**`,
    `- testRunId: \`${payload.testRunId || "(none provided)"}\``,
    `- Loki: ${payload.loki.status}${payload.loki.reason ? ` — ${payload.loki.reason}` : ""}`,
    `- Tempo: ${payload.tempo.status} (${payload.tempo.required ? "required" : "informational"})${payload.tempo.reason ? ` — ${payload.tempo.reason}` : ""}`,
    `- Total log lines: ${payload.loki.lineCount}${payload.loki.truncated ? " (TRUNCATED — safety cap hit)" : ""}`,
    `- Required log scenarios: ${payload.expectedRequired.length}; missing: ${payload.missingRequired.length}; unexpected observed: ${payload.unexpected.length}`,
    "",
    "## Per-scenario log correlation",
    "",
    "| scenarioId | required | observed | lines | result |",
    "| --- | --- | --- | --- | --- |",
    ...payload.scenarios.map(
      (s) => `| \`${s.scenarioId}\` | ${s.required} | ${s.observed} | ${s.lines} | ${s.result} |`
    ),
    "",
  ];
  if (payload.missingRequired.length) {
    md.push("## MISSING required scenarios (FAILED)", "");
    for (const id of payload.missingRequired) md.push(`- ❌ \`${id}\``);
    md.push("");
  }
  if (payload.unexpected.length) {
    md.push("## Unexpected observed scenarios (reported)", "");
    for (const id of payload.unexpected) md.push(`- ⚠️ \`${id}\``);
    md.push("");
  }
  if (payload.traces.length) {
    md.push("## Tempo trace assertions", "");
    md.push("| scenarioId | traceId | found | services | route | result |");
    md.push("| --- | --- | --- | --- | --- | --- |");
    for (const t of payload.traces)
      md.push(
        `| \`${t.scenarioId}\` | \`${t.traceId ?? "—"}\` | ${t.found} | ${(t.services ?? []).join(", ") || "—"} | ${t.routeFound ?? "—"} | ${t.result} |`
      );
    md.push("");
  }
  if (payload.notes.length) {
    md.push("## Notes", "");
    for (const n of payload.notes) md.push(`- ${n}`);
    md.push("");
  }
  writeFileSync(
    `${base}.md`,
    md
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/\s*$/, "") + "\n"
  );
}

async function main() {
  const model = loadModel(ROOT);
  const expanded = expand(model);
  const stageScenarios = scenariosForStage(expanded, STAGE);
  const expectedRequired = requiredLogScenarioIds(expanded, STAGE);
  const traceScenarios = requiredTraceScenarios(expanded, STAGE);

  const report = {
    stage: STAGE,
    testRunId: TEST_RUN_ID,
    result: "DEGRADED",
    loki: { status: "not-checked", reason: null, lineCount: 0, truncated: false },
    tempo: {
      status: "not-configured",
      required: traceScenarios.length > 0,
      reason: null,
      base: null,
    },
    expectedRequired,
    missingRequired: [],
    unexpected: [],
    scenarios: [],
    traces: [],
    notes: [],
    probe: null,
    generatedFor: "ADR-ACT-0285 Phase 3 + closure",
  };

  // --- emit the deterministic pipeline-health probe, then let it ingest ---
  const probeSent = await emitProbeDenial();
  report.probe = { scenario: PROBE_SCENARIO, sent: probeSent };
  if (probeSent) {
    await new Promise((r) => setTimeout(r, Number(process.env["OBS_CORR_INGEST_WAIT_MS"] ?? 9000)));
  }

  let lokiResult = "DEGRADED";
  let observedMap = new Map();

  if (!TEST_RUN_ID) {
    report.loki.reason = "no E2E_TEST_RUN_ID provided — cannot correlate a specific run";
    report.notes.push("DEGRADED: set E2E_TEST_RUN_ID so the harness can correlate this run.");
  } else if (!probeSent) {
    report.loki.reason = "could not reach the BFF to emit the pipeline-health probe";
    report.notes.push("DEGRADED: the BFF was unreachable — correlation cannot be proven.");
  } else {
    try {
      const base = lokiBase();
      const { lines, truncated } = await lokiQueryAll(
        base,
        `{service="platform-api"} | json | testRunId=\`${TEST_RUN_ID}\``
      );
      report.loki.status = "reachable";
      report.loki.lineCount = lines.length;
      report.loki.truncated = truncated;
      if (truncated)
        report.notes.push(
          "WARNING: Loki pagination hit the safety cap — line counts may be incomplete (raise maxPages)."
        );
      observedMap = groupByScenario(lines);
      const completeness = computeCompleteness(stageScenarios, STAGE, observedMap);
      report.scenarios = completeness.perScenario;
      report.missingRequired = completeness.missingRequired;
      report.unexpected = completeness.unexpected;
      lokiResult = completeness.result;
      if (lokiResult === "FAILED")
        report.notes.push(
          `FAILED: ${completeness.missingRequired.length} required scenario(s) produced ZERO correlatable lines: ${completeness.missingRequired.join(", ")}`
        );
      else
        report.notes.push(
          `Correlated ${lines.length} line(s); all ${expectedRequired.length} required scenario(s) observed.`
        );
    } catch (err) {
      report.loki.status = "unreachable";
      report.loki.reason = String(err.message || err);
      report.notes.push(
        "Loki unreachable — correlation could not be collected. DEGRADED, not a pass."
      );
      lokiResult = "DEGRADED";
    }
  }

  // --- Tempo: real trace-by-id assertion for scenarios that declare expectedTraces ---
  let tempoResult = "PASSED"; // no required traces → does not affect the result
  const tb = tempoBase();
  report.tempo.base = tb;
  if (traceScenarios.length === 0) {
    report.tempo.status = tb ? "informational" : "not-configured";
    report.tempo.required = false;
    report.tempo.reason = "no scenario requires trace correlation at this stage";
  } else if (!tb) {
    report.tempo.status = "not-configured";
    report.tempo.required = true;
    report.tempo.reason = "TEMPO_HTTP_PORT not set but a scenario requires trace correlation";
    tempoResult = "DEGRADED";
    report.notes.push(
      "DEGRADED: Tempo is required for trace correlation but is not configured for this stage."
    );
  } else {
    const extraSecrets = [
      process.env["KEYCLOAK_TEST_PASSWORD"],
      process.env["SENTRY_API_TOKEN"],
      process.env["KEYCLOAK_TEST_USERNAME"],
    ].filter(Boolean);
    const traceOutcomes = [];
    for (const sc of traceScenarios) {
      const observed = observedMap.get(sc.scenarioId);
      const rawTraceId = observed ? [...observed.traceIds][0] : null;
      const traceId = parseTraceId(rawTraceId);
      const outcome = {
        scenarioId: sc.scenarioId,
        traceId: traceId ?? rawTraceId ?? null,
        found: false,
        services: [],
        missingServices: sc.expectedTraces.services ?? [],
        routeFound: null,
        secretHits: [],
        result: "FAILED",
      };
      if (!observed) {
        outcome.result = "FAILED";
        outcome.note = "no Loki line for this scenario — cannot extract a traceId";
        report.notes.push(
          `FAILED: trace scenario '${sc.scenarioId}' had no correlatable Loki line.`
        );
        traceOutcomes.push(outcome);
        traceResultPush();
        continue;
      }
      if (!traceId) {
        outcome.result = "FAILED";
        outcome.note = "Loki line carried no valid traceId";
        report.notes.push(`FAILED: scenario '${sc.scenarioId}' Loki line has no valid traceId.`);
        traceOutcomes.push(outcome);
        traceResultPush();
        continue;
      }
      const poll = await pollTempoTrace(tb, traceId, {
        attempts: Number(process.env["TEMPO_POLL_ATTEMPTS"] ?? 8),
        intervalMs: Number(process.env["TEMPO_POLL_INTERVAL_MS"] ?? 2000),
      });
      report.tempo.status = poll.reachable ? "reachable" : "unreachable";
      if (!poll.reachable) {
        outcome.result = "DEGRADED";
        outcome.note = `Tempo unreachable: ${poll.error ?? "network error"}`;
        report.notes.push(`DEGRADED: Tempo unreachable while asserting '${sc.scenarioId}'.`);
        traceOutcomes.push(outcome);
        traceResultPush();
        continue;
      }
      if (!poll.found) {
        outcome.result = "FAILED";
        outcome.note = `trace ${traceId} not found in Tempo after ${poll.attempts} attempt(s) (status ${poll.status})`;
        report.notes.push(
          `FAILED: Loki line exists for '${sc.scenarioId}' but trace ${traceId} is missing in Tempo after polling.`
        );
        traceOutcomes.push(outcome);
        traceResultPush();
        continue;
      }
      const spans = extractSpans(poll.trace);
      const contract = assertTraceContract(spans, sc.expectedTraces, extraSecrets);
      outcome.found = true;
      outcome.services = contract.services;
      outcome.missingServices = contract.missingServices;
      outcome.routeFound = contract.routeFound;
      outcome.secretHits = contract.secretHits;
      outcome.spanCount = contract.spanCount;
      outcome.result = contract.ok ? "PASSED" : "FAILED";
      if (!contract.ok) {
        const why = [];
        if (contract.missingServices.length)
          why.push(`missing services: ${contract.missingServices.join(", ")}`);
        if (!contract.routeFound)
          why.push(`expected route '${sc.expectedTraces.route}' not in any span`);
        if (contract.secretHits.length)
          why.push(`secret(s) leaked into ${contract.secretHits.length} span attribute(s)`);
        outcome.note = why.join("; ");
        report.notes.push(`FAILED: trace for '${sc.scenarioId}' — ${outcome.note}`);
      } else {
        report.notes.push(
          `Trace ${traceId} for '${sc.scenarioId}' matched in Tempo: services [${contract.services.join(", ")}], route ${contract.routeFound}.`
        );
      }
      traceOutcomes.push(outcome);
      traceResultPush();

      function traceResultPush() {
        const r = traceOutcomes[traceOutcomes.length - 1].result;
        tempoResult = worstResult([tempoResult, r]);
      }
    }
    report.traces = traceOutcomes;
    if (report.tempo.status === "not-configured") report.tempo.status = "reachable";
  }

  // --- overall result ---
  if (lokiResult === "DEGRADED") {
    report.result = "DEGRADED";
  } else {
    const combined = worstResult([lokiResult, tempoResult]);
    report.result = combined === "PASSED" ? "FULL" : combined;
  }

  writeReport(report);
  const tag =
    report.result === "FULL"
      ? "\x1b[32m✓\x1b[0m"
      : report.result === "FAILED"
        ? "\x1b[31m✗\x1b[0m"
        : "\x1b[33m⚠\x1b[0m";
  console.log(
    `${tag} e2e observability-correlation: ${report.result} — Loki ${report.loki.status} (${report.loki.lineCount} lines, ${report.missingRequired.length} missing required), Tempo ${report.tempo.status} (${report.traces.length} trace assertion(s)) → docs/evidence/e2e/${STAGE}-observability-correlation-latest.md`
  );
  process.exit(exitCodeForResult(report.result));
}

const invokedDirectly =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) await main();
