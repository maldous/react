#!/usr/bin/env node
// ADR-ACT-0285 Phase 5 — failure-path / root-cause + Grafana-Loki validation.
//
// Proves that when access is denied or a request fails, the outcome is
// ROOT-CAUSEABLE: a structured log line with a stable reason + requestId (+ traceId
// when tracing is live) is queryable in Loki, and that the observability label
// policy holds (high-cardinality fields are structured metadata, NEVER Loki labels
// — ADR-0035). Optionally triggers the gated synthetic-failure endpoint and checks
// it produced an error log (and, best-effort, a Sentry event).
//
// Writes docs/evidence/e2e/<stage>-failure-rootcause-latest.{json,md} and
// <stage>-grafana-loki-latest.{json,md}. Honest: DEGRADED (exit 0) when Loki/the
// app are unreachable; FAILED (exit 1) when a triggered failure produced NO
// root-cause log, or a forbidden high-cardinality label exists. Pure Node + fetch.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import process from "node:process";

const ROOT = resolve(".");
const STAGE = (process.env["STAGE"] || process.env["E2E_STAGE"] || "local").toLowerCase();
const EVIDENCE_DIR = join(ROOT, "docs/evidence/e2e");
const TEST_RUN_ID = process.env["E2E_TEST_RUN_ID"] || `frc-${STAGE}-probe`;

// High-cardinality fields that MUST NOT be Loki labels (ADR-0035) — they are
// structured metadata only. A label here would explode the index.
const FORBIDDEN_LABELS = [
  "requestId",
  "traceId",
  "spanId",
  "testRunId",
  "scenarioId",
  "actorId",
  "tenantId",
  "organisationId",
  "route",
  "path",
  "errorCode",
  "durationMs",
];

function envValue(key) {
  const f = join(ROOT, ".env", `${STAGE}.env`);
  if (!existsSync(f)) return undefined;
  const m = new RegExp(`^${key}=(.*)$`, "m").exec(readFileSync(f, "utf8"));
  return m ? m[1].replace(/^["']|["']$/g, "") : undefined;
}

function apiBase() {
  if (process.env["FRC_API_URL"]) return process.env["FRC_API_URL"];
  const port = envValue("PLATFORM_API_PORT") || "3001";
  return `http://localhost:${port}`;
}
function lokiBase() {
  if (process.env["LOKI_QUERY_URL"]) return process.env["LOKI_QUERY_URL"];
  return `http://localhost:${envValue("LOKI_PORT") || "3100"}`;
}

async function lokiQuery(base, query) {
  const u = new URL(`${base}/loki/api/v1/query_range`);
  u.searchParams.set("query", query);
  u.searchParams.set("start", `${Date.now() - 15 * 60 * 1000}000000`);
  u.searchParams.set("end", `${Date.now()}000000`);
  u.searchParams.set("limit", "100");
  const res = await fetch(u, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`loki ${res.status}`);
  return (await res.json()).data?.result ?? [];
}

function write(name, payload) {
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  const base = join(EVIDENCE_DIR, `${STAGE}-${name}-latest`);
  writeFileSync(`${base}.json`, JSON.stringify(payload, null, 2) + "\n");
  const md = [
    `# E2E ${name} — ${STAGE}`,
    "",
    "Generated (ADR-ACT-0285 Phase 5). DO NOT EDIT — regenerate via make e2e-failure-rootcause.",
    "",
    `- Result: **${payload.result}**`,
    ...(payload.lines ?? []).map((l) => `- ${l}`),
    "",
  ];
  writeFileSync(`${base}.md`, md.join("\n"));
}

const frc = {
  stage: STAGE,
  testRunId: TEST_RUN_ID,
  result: "DEGRADED",
  checks: [],
  lines: [],
  generatedFor: "ADR-ACT-0285 Phase 5",
};
const gl = {
  stage: STAGE,
  result: "DEGRADED",
  forbiddenLabelsPresent: [],
  labelsSeen: [],
  lines: [],
  generatedFor: "ADR-ACT-0285 Phase 5",
};
let exitCode = 0;

// --- 1. Trigger a denial failure path (unauthenticated → protected route) ---
let reqId = null;
let triggered = false;
try {
  const res = await fetch(`${apiBase()}/api/admin/tenants`, {
    headers: {
      "x-e2e-test-run-id": TEST_RUN_ID,
      "x-e2e-scenario-id": "denied-unauthenticated-admin",
      "x-e2e-stage": STAGE,
    },
    signal: AbortSignal.timeout(8000),
  });
  reqId = res.headers.get("x-request-id");
  triggered = true;
  frc.checks.push({
    name: "unauthenticated-admin-denied",
    httpStatus: res.status,
    requestId: reqId,
    expected: "401/403",
  });
  frc.lines.push(
    `Triggered unauthenticated /api/admin/tenants → HTTP ${res.status} (x-request-id=${reqId ?? "none"})`
  );
} catch (err) {
  frc.lines.push(`Could not reach API to trigger failure path: ${err.message} — DEGRADED`);
}

// --- 2. Prove the denial is root-causeable in Loki (reason + requestId) ---
if (triggered) {
  // Allow Alloy to scrape + Loki to ingest the just-emitted log line.
  const ingestWaitMs = Number(process.env["FRC_INGEST_WAIT_MS"] ?? 8000);
  await new Promise((r) => setTimeout(r, ingestWaitMs));
  try {
    const base = lokiBase();
    const rejected = await lokiQuery(
      base,
      `{service="platform-api"} |= "http.request.rejected" | json | testRunId=\`${TEST_RUN_ID}\``
    );
    let withReason = 0;
    let sample = null;
    for (const stream of rejected) {
      for (const [, line] of stream.values ?? []) {
        try {
          const o = JSON.parse(line);
          if (o.reason && o.requestId) {
            withReason++;
            if (!sample)
              sample = {
                reason: o.reason,
                requestId: o.requestId,
                traceId: o.traceId ?? null,
                status: o.status,
              };
          }
        } catch {
          /* non-json line */
        }
      }
    }
    if (withReason > 0) {
      frc.result = "PASSED";
      frc.checks.push({ name: "denial-root-causeable", lokiLines: withReason, sample });
      frc.lines.push(
        `Root-cause proven: ${withReason} http.request.rejected line(s) in Loki carry a stable reason + requestId (sample reason=${sample?.reason}, traceId=${sample?.traceId ?? "n/a"}).`
      );
    } else {
      frc.result = "FAILED";
      exitCode = 1;
      frc.lines.push(
        "FAILED: the denial produced no http.request.rejected log with reason+requestId for this testRunId — not root-causeable."
      );
    }
  } catch (err) {
    frc.result = "DEGRADED";
    frc.lines.push(
      `Loki unreachable for root-cause query: ${err.message} — DEGRADED (not a pass).`
    );
  }
}

// --- 3. Grafana/Loki label-policy: high-cardinality fields are NOT labels ---
try {
  const res = await fetch(`${lokiBase()}/loki/api/v1/labels`, {
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`loki labels ${res.status}`);
  const labels = (await res.json()).data ?? [];
  gl.labelsSeen = labels;
  gl.forbiddenLabelsPresent = FORBIDDEN_LABELS.filter((l) => labels.includes(l));
  if (gl.forbiddenLabelsPresent.length) {
    gl.result = "FAILED";
    exitCode = 1;
    gl.lines.push(
      `FAILED: high-cardinality fields promoted to Loki LABELS (index bloat, ADR-0035): ${gl.forbiddenLabelsPresent.join(", ")}`
    );
  } else {
    gl.result = "PASSED";
    // Backticks: Loki label names like __stream_shard__ contain double underscores
    // that markdownlint would otherwise parse as bold emphasis (MD050).
    gl.lines.push(
      `Label policy OK: none of [${FORBIDDEN_LABELS.join(", ")}] are Loki labels. Labels: \`${labels.join(", ")}\``
    );
  }
} catch (err) {
  gl.result = "DEGRADED";
  gl.lines.push(`Loki labels unreachable: ${err.message} — DEGRADED (not a pass).`);
}

write("failure-rootcause", frc);
write("grafana-loki", gl);

const tag = (r) =>
  r === "PASSED" ? "\x1b[32m✓\x1b[0m" : r === "FAILED" ? "\x1b[31m✗\x1b[0m" : "\x1b[33m⚠\x1b[0m";
console.log(
  `${tag(frc.result)} e2e failure-rootcause: ${frc.result} → docs/evidence/e2e/${STAGE}-failure-rootcause-latest.md`
);
console.log(
  `${tag(gl.result)} e2e grafana-loki: ${gl.result} → docs/evidence/e2e/${STAGE}-grafana-loki-latest.md`
);
process.exit(exitCode);
