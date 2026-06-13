/**
 * Provider configuration LIVE proof (ADR-0070 / ADR-ACT-0266 — Tier-1 kernel).
 *
 * Proves the provider-config plane against the local Compose Postgres:
 *  - put + list round-trip; the config plane never carries a plaintext secret;
 *  - a credential must be an opaque secret-store ref — a plaintext-looking credentialRef
 *    is rejected (ValidationError);
 *  - config with a secret-bearing key is rejected;
 *  - a forbidden-in-production provider can NEVER be active (configured/ready) in prod;
 *  - a provider that REQUIRES a credential but has none is forced to `degraded`
 *    (provider with missing secretRef is degraded);
 *  - a `candidate` provider does not imply a delivered capability (lifecycle stays
 *    candidate, never auto-ready).
 *
 * Requires Postgres. SKIPs honestly (exit 0) if unavailable; never fake-PASSes.
 * Usage: npm run proof:provider-config   (requires `make compose-up-default`)
 */

import pg from "pg";
import { loadLocalEnv } from "./lib/local-env.ts";
import type { AuditEvent, AuditEventPort } from "@platform/audit-events";
import { PostgresProviderConfigRepository } from "../src/adapters/postgres-provider-config-repository.ts";
import {
  deleteProviderConfig,
  listProviderConfigs,
  putProviderConfig,
} from "../src/usecases/provider-config.ts";

loadLocalEnv();
const APP_URL =
  process.env["POSTGRES_APP_URL"] ??
  "postgresql://platform_app:platformapppassword@localhost:5433/platform";
const SU_URL =
  process.env["POSTGRES_URL"] ?? "postgresql://platform:platformpassword@localhost:5433/platform";
const SECRET_FIELD = /secret|password|token|credential|api[_-]?key|private[_-]?key/i;
const PROVIDER = "proof-pc-" + Date.now().toString(36);
const ACTOR = { actorId: "00000000-0000-0000-0000-000000000000", actorRoles: ["system-admin"] };

let failures = 0;
function check(label: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}
function capturingAudit(): { port: AuditEventPort; events: AuditEvent[] } {
  const events: AuditEvent[] = [];
  return { events, port: { emit: async (e) => void events.push(e), query: async () => events } };
}
async function pgReachable(url: string): Promise<boolean> {
  const p = new pg.Pool({ connectionString: url, connectionTimeoutMillis: 2000, max: 1 });
  try {
    await p.query("SELECT 1");
    return true;
  } catch {
    return false;
  } finally {
    await p.end().catch(() => {});
  }
}
async function rejects(fn: () => Promise<unknown>): Promise<boolean> {
  try {
    await fn();
    return false;
  } catch {
    return true;
  }
}

async function main(): Promise<void> {
  console.log("# Provider configuration LIVE proof\n");
  if (!(await pgReachable(APP_URL))) {
    console.log("SKIP  provider-config proof — Postgres not reachable (`make compose-up-default`)");
    console.log("\n# SKIPPED (no live backend) — not counted as pass or fail");
    process.exit(0);
  }

  const su = new pg.Pool({ connectionString: SU_URL });
  const app = new pg.Pool({ connectionString: APP_URL });
  const repo = new PostgresProviderConfigRepository(app);
  const audit = capturingAudit();
  const deps = { providers: repo, audit: audit.port };

  try {
    // put a candidate provider (search) — no credential required, classification per-env
    const created = await putProviderConfig(
      {
        providerKey: PROVIDER,
        capability: "search-indexing",
        environment: "development",
        instanceLabel: "default",
        classification: "per-environment",
        lifecycleState: "candidate",
        endpoint: "http://localhost:7700",
        config: { indexPrefix: "tenant_" },
        actor: ACTOR,
      },
      deps
    );
    check("put returns the provider config", created.providerKey === PROVIDER);
    check(
      "a candidate provider does not imply a delivered capability",
      created.lifecycleState === "candidate"
    );

    const listed = await listProviderConfigs(deps, { capability: "search-indexing" });
    const row = listed.providers.find((p) => p.providerKey === PROVIDER);
    check("list returns the provider config", !!row);
    check(
      "provider config carries no plaintext secret (config keys are non-secret)",
      !!row && !Object.keys(row.config).some((k) => SECRET_FIELD.test(k))
    );

    // credential must be a secret-store ref — plaintext-looking value rejected
    check(
      "a plaintext-looking credentialRef is rejected",
      await rejects(() =>
        putProviderConfig(
          {
            providerKey: PROVIDER,
            capability: "search-indexing",
            environment: "development",
            classification: "per-environment",
            lifecycleState: "configured",
            credentialRef: "super-secret-api-key" as unknown as `secret:${string}`,
            actor: ACTOR,
          },
          deps
        )
      )
    );

    // config with a secret-bearing key is rejected
    check(
      "config with a secret-bearing key is rejected",
      await rejects(() =>
        putProviderConfig(
          {
            providerKey: PROVIDER,
            capability: "search-indexing",
            environment: "development",
            classification: "per-environment",
            lifecycleState: "configured",
            config: { apiKey: "leaked" },
            actor: ACTOR,
          },
          deps
        )
      )
    );

    // forbidden-in-production provider can never be active in production
    check(
      "a forbidden-in-production provider cannot be active in prod",
      await rejects(() =>
        putProviderConfig(
          {
            providerKey: PROVIDER,
            capability: "mock-providers",
            environment: "production",
            classification: "forbidden-in-production",
            lifecycleState: "ready",
            actor: ACTOR,
          },
          deps
        )
      )
    );

    // requiresCredential + no credentialRef → forced to degraded
    const degraded = await putProviderConfig(
      {
        providerKey: PROVIDER,
        capability: "search-indexing",
        environment: "development",
        classification: "per-environment",
        lifecycleState: "ready",
        requiresCredential: true,
        actor: ACTOR,
      },
      deps
    );
    check(
      "a provider that requires a credential but has none is degraded (not ready)",
      degraded.lifecycleState === "degraded"
    );

    // audit emitted, carries no secret
    check(
      "provider-config mutations are audited with no secret",
      audit.events.length >= 1 && audit.events.every((e) => !JSON.stringify(e).includes("leaked"))
    );

    // delete cleanup
    const del = await deleteProviderConfig({ id: created.id, actor: ACTOR }, deps);
    check("delete removes the provider config", del.kind === "ok");
  } catch (err) {
    check("provider-config proof", false, err instanceof Error ? err.message : String(err));
  } finally {
    await su
      .query("DELETE FROM public.provider_configs WHERE provider_key = $1", [PROVIDER])
      .catch(() => {});
    await app.end().catch(() => {});
    await su.end().catch(() => {});
  }

  console.log(
    failures === 0 ? "\n# ALL CHECKS PASSED (live Postgres)" : `\n# ${failures} CHECK(S) FAILED`
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("proof failed:", err);
  process.exit(1);
});
