/**
 * Environment seed (ADR-0072 / ADR-ACT-0274). Run via the loader, like the proofs.
 *
 * Subcommands (idempotent; honest SKIP when Postgres is unreachable):
 *   sync       Project the manifests into environment_registry (env-init).
 *   providers  Seed provider_configs from the manifest's seededProviderDefaults
 *              (lifecycle 'candidate' — never auto-ready; credentials by ref only).
 *   reconcile  Re-sync + mark the environment reconciled.
 *   all        sync + providers + provider-config status.
 *
 * Usage: node --loader apps/platform-api/loader.mjs apps/platform-api/scripts/seed-environment.ts <sub> <stage|--all>
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import pg from "pg";
import { loadLocalEnv } from "./lib/local-env.ts";
import type { AuditEvent, AuditEventPort } from "@platform/audit-events";
import { PostgresEnvironmentRegistryRepository } from "../src/adapters/postgres-environment-registry-repository.ts";
import { PostgresProviderConfigRepository } from "../src/adapters/postgres-provider-config-repository.ts";
import {
  ENVIRONMENT_PERMISSIONS,
  recordReconcile,
  setProviderConfigStatus,
  syncEnvironmentsFromManifests,
  type EnvironmentActor,
  type EnvironmentManifestDescriptor,
} from "../src/usecases/environment-registry.ts";
import { putProviderConfig } from "../src/usecases/provider-config.ts";

const STAGES = ["dev", "test", "staging", "prod"] as const;
const STAGE_ENV: Record<string, "development" | "test" | "staging" | "production"> = {
  dev: "development",
  test: "test",
  staging: "staging",
  prod: "production",
};

const actor: EnvironmentActor = {
  actorId: "00000000-0000-0000-0000-000000000000",
  actorRoles: ["system-admin"],
  actorPermissions: Object.values(ENVIRONMENT_PERMISSIONS),
};

function auditSink(): AuditEventPort {
  const events: AuditEvent[] = [];
  return { emit: async (e) => void events.push(e), query: async () => events };
}
function loadManifest(stage: string): EnvironmentManifestDescriptor {
  return JSON.parse(
    readFileSync(join(process.cwd(), "config", "environments", `${stage}.json`), "utf8")
  ) as EnvironmentManifestDescriptor;
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

async function main(): Promise<void> {
  loadLocalEnv();
  const [sub, target] = process.argv.slice(2);
  const stages = !target || target === "--all" ? [...STAGES] : [target];
  const SU_URL =
    process.env["POSTGRES_URL"] ?? "postgresql://platform:platformpassword@localhost:5433/platform";
  const APP_URL =
    process.env["POSTGRES_APP_URL"] ??
    "postgresql://platform_app:platformapppassword@localhost:5433/platform";

  if (!(await pgReachable(SU_URL))) {
    console.log(
      `SKIP  seed-environment ${sub} — Postgres not reachable (\`make compose-up-default\`).`
    );
    process.exit(0);
  }

  const su = new pg.Pool({ connectionString: SU_URL });
  const app = new pg.Pool({ connectionString: APP_URL });
  const envRepo = new PostgresEnvironmentRegistryRepository(app);
  const provRepo = new PostgresProviderConfigRepository(app);
  const audit = auditSink();
  const envDeps = { environments: envRepo, audit };

  try {
    // Ensure the registry table exists (idempotent — migration 033).
    const ddl = readFileSync(
      join(process.cwd(), "apps/platform-api/src/db/migrations/033-environment-registry.sql"),
      "utf8"
    );
    await su.query(ddl);

    const manifests = stages.map(loadManifest);

    if (sub === "sync" || sub === "all" || sub === "reconcile") {
      await syncEnvironmentsFromManifests(envDeps, actor, manifests);
      console.log(`✓ env registry synced: ${stages.join(", ")}`);
    }

    if (sub === "providers" || sub === "all") {
      for (const m of manifests) {
        const defaults = (m.seededProviderDefaults ?? []) as Array<{
          providerKey: string;
          capability: string;
          classification: string;
          requiresCredential?: boolean;
        }>;
        let n = 0;
        for (const d of defaults) {
          await putProviderConfig(
            {
              providerKey: d.providerKey,
              capability: d.capability,
              environment: STAGE_ENV[m.stage as string] ?? "development",
              instanceLabel: "default",
              classification: d.classification,
              // candidate — never auto-ready; readiness is adapter-confirmed (ADR-0070).
              lifecycleState: "candidate",
              endpoint: null,
              credentialRef: null,
              config: {},
              requiresCredential: d.requiresCredential ?? false,
              actor: { actorId: actor.actorId, actorRoles: actor.actorRoles },
            } as never,
            { providers: provRepo, audit }
          );
          n++;
        }
        await setProviderConfigStatus(
          envDeps,
          actor,
          m.environmentId,
          n > 0 ? "partial" : "unconfigured"
        );
        console.log(`✓ ${m.environmentId}: seeded ${n} provider default(s) as candidate`);
      }
    }

    if (sub === "reconcile") {
      for (const m of manifests) await recordReconcile(envDeps, actor, m.environmentId);
      console.log(`✓ env reconciled: ${stages.join(", ")}`);
    }
  } finally {
    await su.end().catch(() => {});
    await app.end().catch(() => {});
  }
}

void main();
