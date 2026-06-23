/**
 * Composed provider readiness LIVE proof (ADR-0071 / ADR-ACT-0271).
 *
 * Proves the composed-provider readiness spine that feeds the provider-config
 * adapter-confirmed lifecycle (ADR-0070):
 *  - each provider with a reachable health endpoint reports `ready`;
 *  - a wired-but-unreachable provider reports `degraded`;
 *  - a provider with NO endpoint wired reports `not_configured` and lifecycle
 *    `candidate` (a candidate is never a delivered capability);
 *  - the derived lifecycle is adapter-confirmed (ready⇒ready, degraded⇒degraded);
 *  - NO secret (Meilisearch master key, etc.) appears in any readiness payload.
 *
 * This proof does NOT require any composed container to be up — it proves the HONEST
 * readiness contract either way. Providers that are up are genuinely readiness-proven;
 * providers that are down report degraded/not_configured (never faked).
 *
 * Usage: npm run proof:composed-provider-readiness
 *   (optionally `make compose-up-search-provider` + `make compose-up-observability-provider`)
 */

import { loadLocalEnv } from "./lib/local-env.ts";
import { getComposedProviderReadiness } from "../src/usecases/composed-providers.ts";
import assert from "node:assert/strict";

loadLocalEnv();
// Probe Tempo too when its container is up (host port 3201 → container 3200).
if (!process.env["TEMPO_URL"]) process.env["TEMPO_URL"] = "http://localhost:3201";
const SECRET_FIELD = /master[_-]?key|secret|password|token|api[_-]?key|private[_-]?key/i;

let failures = 0;
function check(label: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}` + (detail ? ` — ${detail}` : ""));
  if (!ok) failures++;
  assert.equal(ok, true, detail ? `${label}: ${detail}` : label);
}

async function reachable(url: string | undefined): Promise<boolean> {
  if (!url) return false;
  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 2000);
    const res = await fetch(url, { signal: ac.signal }).finally(() => clearTimeout(t));
    return res.ok;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  console.log("# Composed provider readiness LIVE proof\n");

  // Ground truth for the light providers (defaults match the compose ports).
  const meiliUp = await reachable(
    (process.env["MEILISEARCH_URL"] ?? "http://localhost:7700") + "/health"
  );
  const promUp = await reachable(
    (process.env["PROMETHEUS_URL"] ?? "http://localhost:9090") + "/-/ready"
  );
  const amUp = await reachable(
    (process.env["ALERTMANAGER_URL"] ?? "http://localhost:9093") + "/-/ready"
  );

  const { providers } = await getComposedProviderReadiness();
  const byKey = Object.fromEntries(providers.map((p) => [p.provider, p]));

  check("all six composed providers are reported", providers.length === 6, `n=${providers.length}`);

  // status enum is honest for every row
  check(
    "every provider reports a valid honest status",
    providers.every((p) => ["ready", "degraded", "not_configured"].includes(p.status))
  );

  // ground-truth consistency for the light providers
  if (meiliUp)
    check("meilisearch reports ready when reachable", byKey["meilisearch"]?.status === "ready");
  else
    check(
      "meilisearch reports degraded when unreachable",
      byKey["meilisearch"]?.status === "degraded"
    );
  if (promUp)
    check("prometheus reports ready when reachable", byKey["prometheus"]?.status === "ready");
  else
    check(
      "prometheus reports degraded when unreachable",
      byKey["prometheus"]?.status === "degraded"
    );
  if (amUp)
    check("alertmanager reports ready when reachable", byKey["alertmanager"]?.status === "ready");
  else
    check(
      "alertmanager reports degraded when unreachable",
      byKey["alertmanager"]?.status === "degraded"
    );

  // adapter-confirmed lifecycle derivation
  check(
    "lifecycle is adapter-confirmed (ready⇒ready, degraded⇒degraded, not_configured⇒candidate)",
    providers.every(
      (p) =>
        (p.status === "ready" && p.lifecycleState === "ready") ||
        (p.status === "degraded" && p.lifecycleState === "degraded") ||
        (p.status === "not_configured" && p.lifecycleState === "candidate")
    )
  );

  // Heavy providers stay candidates unless explicitly wired; once wired, the
  // same readiness contract must report the live probe result honestly.
  if (process.env["WINDMILL_URL"]) {
    check(
      "windmill reports ready when endpoint is configured and reachable",
      byKey["windmill"]?.status === "ready" && byKey["windmill"]?.lifecycleState === "ready"
    );
  } else {
    check(
      "windmill (no endpoint) is not_configured / candidate",
      byKey["windmill"]?.status === "not_configured" &&
        byKey["windmill"]?.lifecycleState === "candidate"
    );
  }
  if (process.env["TEMPORAL_HTTP_URL"]) {
    check(
      "temporal reports honest readiness when endpoint is configured",
      byKey["temporal"]?.status !== "not_configured" &&
        byKey["temporal"]?.lifecycleState !== "candidate"
    );
  } else {
    check(
      "temporal (no endpoint) is not_configured / candidate",
      byKey["temporal"]?.status === "not_configured" &&
        byKey["temporal"]?.lifecycleState === "candidate"
    );
  }

  // no secret in any readiness payload
  check(
    "no secret (master key/token) in any readiness payload",
    !providers.some((p) => SECRET_FIELD.test(JSON.stringify(p)))
  );

  const live = [meiliUp && "meilisearch", promUp && "prometheus", amUp && "alertmanager"].filter(
    Boolean
  );
  console.log(
    `\n(live readiness-proven this run: ${live.length ? live.join(", ") : "none up — contract still proven honestly"})`
  );
  console.log(failures === 0 ? "# ALL CHECKS PASSED" : `# ${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("proof failed:", err);
  process.exit(1);
});
