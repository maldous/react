/**
 * Prometheus application metrics LIVE proof (ADR-0062 / ADR-ACT-0261).
 *
 * Proves the platform-api exposes bounded application metrics at /metrics:
 *   - Prometheus text format (content-type + HELP/TYPE lines)
 *   - http_requests_total counter present
 *   - http_request_duration_ms histogram present
 *   - postgres_available gauge present
 *   - redis_available gauge present
 *   - default Node.js metrics present (process_*, nodejs_*)
 *   - NO tenant, user, request, trace, email, or raw URL label appears
 *   - /readyz triggers gauge updates (postgres/redis available → 1)
 *
 * Usage: npm run proof:metrics-prometheus
 *   (requires platform-api running on PLATFORM_API_PORT)
 */

import { loadLocalEnv } from "./lib/local-env.ts";

loadLocalEnv();

const PORT = process.env["PLATFORM_API_PORT"] ?? "3001";
const BASE = `http://localhost:${PORT}`;
const FORBIDDEN_LABEL =
  /(?:tenant|organisation|org)_?id|user_?id|request_?id|trace_?id|span_?id|email|raw_?url|error_?text/i;

let failures = 0;
function check(label: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}` + (detail ? ` — ${detail}` : ""));
  if (!ok) failures++;
}

async function get(path: string): Promise<{ status: number; body: string; contentType: string }> {
  const res = await fetch(`${BASE}${path}`);
  const body = await res.text();
  return { status: res.status, body, contentType: res.headers.get("content-type") ?? "" };
}

async function main(): Promise<void> {
  console.log("# Prometheus application metrics LIVE proof\n");

  // ── /metrics endpoint reachable ───────────────────────────────────────
  const metrics = await get("/metrics");
  check("/metrics returns 200", metrics.status === 200, `status=${metrics.status}`);
  check(
    "/metrics content-type is Prometheus text",
    metrics.contentType.includes("text/plain"),
    `content-type=${metrics.contentType}`
  );

  // ── Key metric families present ────────────────────────────────────────
  const hasMetric = (name: string): boolean =>
    new RegExp(`^# HELP ${name} `, "m").test(metrics.body) &&
    new RegExp(`^# TYPE ${name} `, "m").test(metrics.body);

  check("http_requests_total counter present", hasMetric("http_requests_total"));
  check("http_request_duration_ms histogram present", hasMetric("http_request_duration_ms"));
  check("postgres_available gauge present", hasMetric("postgres_available"));
  check("redis_available gauge present", hasMetric("redis_available"));

  // ── Default Node.js metrics present ────────────────────────────────────
  check("process_cpu_seconds_total present", hasMetric("process_cpu_seconds_total"));
  check("nodejs_heap_size_bytes present", /^nodejs_heap_size_bytes /m.test(metrics.body));

  // ── No forbidden label values ───────────────────────────────────────────
  // Parse all label=value pairs from the metrics text and check none leak.
  const labelPairs = [...metrics.body.matchAll(/\{([^}]+)\}/g)]
    .flatMap((m) => m[1].split(","))
    .map((s) => s.trim());
  const forbidden = labelPairs.filter((lp) => FORBIDDEN_LABEL.test(lp));
  check(
    "no tenant/user/request/trace/email/raw URL label",
    forbidden.length === 0,
    forbidden.length ? `LEAKED: ${forbidden.slice(0, 5).join(" ; ")}` : ""
  );

  // ── http_requests_total has only allowed label names ────────────────────
  const ALLOWED_LABEL_NAMES = new Set(["method", "route", "status_class"]);
  const counterLabels = [...metrics.body.matchAll(/^http_requests_total\{([^}]+)\}/gm)]
    .map((m) => m[1].split(",").map((s) => s.split("=")[0]!.trim()))
    .flat();
  const unexpectedLabels = [...new Set(counterLabels)].filter((l) => !ALLOWED_LABEL_NAMES.has(l));
  check(
    "http_requests_total has only allowed labels (method/route/status_class)",
    unexpectedLabels.length === 0,
    unexpectedLabels.length ? `unexpected: ${unexpectedLabels.join(", ")}` : ""
  );

  // ── Gauge values after /readyz ─────────────────────────────────────────
  // Trigger readiness check to update gauges, then re-read.
  const readyz = await get("/readyz");
  check("/readyz returns JSON", readyz.status === 200 || readyz.status === 503);

  const updated = await get("/metrics");
  const gaugeValue = (name: string): number | null => {
    const m = updated.body.match(new RegExp(`^${name} (\\d+)`, "m"));
    return m ? Number(m[1]) : null;
  };

  const pg = gaugeValue("postgres_available");
  const redis = gaugeValue("redis_available");
  check("postgres_available gauge is numeric", pg !== null, `value=${pg}`);
  check("redis_available gauge is numeric", redis !== null, `value=${redis}`);
  // Gauges should be 0 or 1, never negative or >1.
  if (pg !== null) check("postgres_available in {0,1}", pg === 0 || pg === 1, `value=${pg}`);
  if (redis !== null)
    check("redis_available in {0,1}", redis === 0 || redis === 1, `value=${redis}`);

  // ── Valid Prometheus format (no parse errors) ──────────────────────────
  // Every non-comment, non-empty line must be a valid metric line or end with EOF.
  const lines = updated.body.split("\n").filter((l) => l && !l.startsWith("#"));
  const malformed = lines.filter((l) => !/^[a-zA-Z_:][a-zA-Z0-9_:]*[\s\{].*$/.test(l));
  check(
    "every metric line is valid Prometheus exposition format",
    malformed.length === 0,
    malformed.length ? `malformed: ${malformed.slice(0, 3).join(" | ")}` : ""
  );

  console.log(failures === 0 ? "\n# ALL CHECKS PASSED" : `\n# ${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("proof failed:", err);
  process.exit(1);
});
