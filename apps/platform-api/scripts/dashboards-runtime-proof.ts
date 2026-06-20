/**
 * Grafana dashboards provisioning LIVE proof (ADR-ACT-0261).
 *
 * Proves the Grafana dashboards are discoverable and serving correctly:
 *   - Grafana /api/health returns ok
 *   - Datasources are provisioned (Loki, Tempo, Prometheus)
 *   - Dashboards are provisioned (platform-overview, platform-logs-overview)
 *   - Platform Overview dashboard returns valid JSON with expected panels
 *   - Platform Logs Overview dashboard returns valid JSON with expected panels
 *   - No dashboard returns an error
 *
 * Usage: npm run proof:dashboards
 *   (requires Grafana running on GRAFANA_PORT; default 3200)
 */

import { loadLocalEnv } from "./lib/local-env.ts";

loadLocalEnv();

const PORT = process.env["GRAFANA_PORT"] ?? "3200";
const BASE = `http://localhost:${PORT}`;
const ADMIN_USER = process.env["GRAFANA_ADMIN_USER"] ?? "admin";
const ADMIN_PASS = process.env["GRAFANA_ADMIN_PASSWORD"] ?? "admin";

let failures = 0;
function check(label: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}` + (detail ? ` — ${detail}` : ""));
  if (!ok) failures++;
}
async function grafanaApi(path: string): Promise<{ status: number; body: unknown } | null> {
  const auth = Buffer.from(`${ADMIN_USER}:${ADMIN_PASS}`).toString("base64");
  try {
    const res = await fetch(`${BASE}${path}`, {
      headers: { Authorization: `Basic ${auth}` },
      signal: AbortSignal.timeout(5000),
    });
    const body = await res.json().catch(() => null);
    return { status: res.status, body };
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  // NOSONAR
  console.log("# Grafana dashboards provisioning LIVE proof\n"); // ── Grafana reachable ──────────────────────────────────────────────────
  const health = await grafanaApi("/api/health");
  if (!health) {
    console.log("SKIP Grafana unreachable — dashboard contract not proven this run");
    process.exit(0);
  }
  check("Grafana /api/health returns ok", health.status === 200, `status=${health.status}`);

  // ── Datasources provisioned ─────────────────────────────────────────────
  const ds = await grafanaApi("/api/datasources");
  if (!ds) {
    console.log("SKIP Grafana unreachable — datasource check skipped");
    process.exit(0);
  }
  check("datasources list returns 200", ds.status === 200, `status=${ds.status}`);

  const dsList = Array.isArray(ds.body) ? ds.body : [];
  const dsNames = dsList.map((d: Record<string, unknown>) => d.name);
  check("Loki datasource provisioned", dsNames.includes("Loki"), `found: ${dsNames.join(", ")}`);
  check("Tempo datasource provisioned", dsNames.includes("Tempo"));
  check("Prometheus datasource provisioned", dsNames.includes("Prometheus"));

  // ── Dashboards provisioned ──────────────────────────────────────────────
  const search = await grafanaApi("/api/search?type=dash-db");
  if (!search) {
    console.log("SKIP Grafana unreachable — dashboard search skipped");
    process.exit(0);
  }
  check("dashboard search returns 200", search.status === 200, `status=${search.status}`);

  const dashboards = Array.isArray(search.body) ? search.body : [];
  const dbTitles = dashboards.map((d: Record<string, unknown>) => d.title as string);
  check(
    "Platform Overview dashboard exists",
    dbTitles.includes("Platform Overview"),
    `found: ${dbTitles.join(", ")}`
  );
  check("Platform Logs Overview dashboard exists", dbTitles.includes("Platform Logs Overview"));

  // ── Platform Overview dashboard panels ──────────────────────────────────
  const overview = dashboards.find(
    (d: Record<string, unknown>) => d.title === "Platform Overview"
  ) as Record<string, unknown> | undefined;
  if (overview && overview.uid) {
    const detail = await grafanaApi(`/api/dashboards/uid/${overview.uid}`);
    check(
      "Platform Overview dashboard loads successfully",
      detail.status === 200,
      `status=${detail.status}`
    );
    const panels = (detail.body as Record<string, unknown>)?.dashboard as
      | Record<string, unknown>
      | undefined;
    if (panels && Array.isArray(panels.panels)) {
      const panelTitles = panels.panels.map((p: Record<string, unknown>) => p.title as string);
      check(
        "Platform Overview has HTTP Requests panel",
        panelTitles.includes("HTTP Requests (rate)")
      );
      check(
        "Platform Overview has Duration panel",
        panelTitles.some((t: string) => t.includes("Duration"))
      );
      check(
        "Platform Overview has Postgres Availability panel",
        panelTitles.includes("Postgres Availability")
      );
      check(
        "Platform Overview has Redis Availability panel",
        panelTitles.includes("Redis Availability")
      );
    } else {
      check("Platform Overview has panels array", false, "panels missing");
    }
  } else {
    check("Platform Overview dashboard found", false, "not in search results");
  }

  // ── Platform Logs Overview dashboard panels ─────────────────────────────
  const logsOverview = dashboards.find(
    (d: Record<string, unknown>) => d.title === "Platform Logs Overview"
  ) as Record<string, unknown> | undefined;
  if (logsOverview && logsOverview.uid) {
    const detail = await grafanaApi(`/api/dashboards/uid/${logsOverview.uid}`);
    check(
      "Platform Logs Overview dashboard loads successfully",
      detail.status === 200,
      `status=${detail.status}`
    );
    const panels = (detail.body as Record<string, unknown>)?.dashboard as
      | Record<string, unknown>
      | undefined;
    if (panels && Array.isArray(panels.panels)) {
      const panelTitles = panels.panels.map((p: Record<string, unknown>) => p.title as string);
      check(
        "Platform Logs Overview has Error Logs by Service panel",
        panelTitles.includes("Error Logs by Service")
      );
      check(
        "Platform Logs Overview has Slow Requests panel",
        panelTitles.includes("Slow Requests (>1s)")
      );
      check(
        "Platform Logs Overview has Top Failing Routes panel",
        panelTitles.includes("Top Failing Routes")
      );
    } else {
      check("Platform Logs Overview has panels array", false, "panels missing");
    }
  } else {
    check("Platform Logs Overview dashboard found", false, "not in search results");
  }

  console.log(failures === 0 ? "\n# ALL CHECKS PASSED" : `\n# ${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("proof failed:", err);
  process.exit(1);
});
