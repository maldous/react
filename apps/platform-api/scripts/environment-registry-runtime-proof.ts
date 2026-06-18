/**
 * Environment registry LIVE proof (ADR-0072 / ADR-ACT-0274).
 *
 * Proves the environment registry against the local Compose Postgres:
 *  - sync from the tracked manifests (config/environments/<stage>.json) projects the
 *    whole ladder (dev/test/staging/prod) into environment_registry;
 *  - the registry carries NO secret-looking value (it is non-secret intent + state);
 *  - mocks are forbidden in staging/production (mockPolicy=no-mocks; allowedMocks=[]),
 *    allowed in dev/test (mocks-allowed);
 *  - defence-in-depth: registering a staging env with mocks is rejected (ValidationError),
 *    and a direct INSERT that allows mocks in production is rejected by a DB CHECK;
 *  - every operation requires a platform.environment.* permission (missing -> Forbidden);
 *  - the bootstrap lifecycle is recorded and stamps last_bootstrapped_at (not faked).
 *
 * Requires Postgres. SKIPs honestly (exit 0) if unavailable; never fake-PASSes.
 * Usage: npm run proof:environment-registry   (requires `make compose-up-default`)
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { loadLocalEnv, requireEnv } from "./lib/local-env.ts";
import type { AuditEvent, AuditEventPort } from "@platform/audit-events";
import { PostgresEnvironmentRegistryRepository } from "../src/adapters/postgres-environment-registry-repository.ts";
import {
  ENVIRONMENT_PERMISSIONS,
  getEnvironment,
  listEnvironments,
  recordBootstrap,
  registerEnvironment,
  syncEnvironmentsFromManifests,
  type EnvironmentActor,
  type EnvironmentManifestDescriptor,
} from "../src/usecases/environment-registry.ts";

loadLocalEnv();
const SU_URL = requireEnv("POSTGRES_URL");
const APP_URL = requireEnv("POSTGRES_APP_URL");
// Detects actual secret MATERIAL in serialised records (not field names like
// "secretStoreProvider"): hex/crypto material, the local-bootstrap password prefix,
// or the pinned container-bootstrap passwords.
const SECRET_VALUE = /[0-9a-f]{24,}|Bs1-[0-9a-f]|platformpassword|clickhousepassword/i;
const STAGES = ["dev", "test", "staging", "prod"] as const;

const ALL_PERMS = Object.values(ENVIRONMENT_PERMISSIONS);
const operator = (perms: string[] = ALL_PERMS): EnvironmentActor => ({
  actorId: "00000000-0000-0000-0000-000000000000",
  actorRoles: ["system-admin"],
  actorPermissions: perms,
});

let failures = 0;
function check(label: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}` + (detail ? ` — ${detail}` : ""));
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
function loadManifestDescriptor(stage: string): EnvironmentManifestDescriptor {
  const path = join(process.cwd(), "config", "environments", `${stage}.json`);
  return JSON.parse(readFileSync(path, "utf8")) as EnvironmentManifestDescriptor;
}

async function main(): Promise<void> {
  console.log("# Environment registry LIVE proof\n");
  if (!(await pgReachable(SU_URL))) {
    console.log(
      "SKIP  environment-registry proof — Postgres not reachable (`make compose-up-default`)"
    );
    console.log("\n# SKIPPED (no live backend) — not counted as pass or fail");
    process.exit(0);
  }

  const su = new pg.Pool({ connectionString: SU_URL });
  const app = new pg.Pool({ connectionString: APP_URL });
  const repo = new PostgresEnvironmentRegistryRepository(app);
  const audit = capturingAudit();
  const deps = { environments: repo, audit: audit.port };

  try {
    // Ensure the table exists (idempotent — migration 033). Proofs run after
    // db:migrate, but applying the idempotent DDL keeps this self-contained.
    const ddl = readFileSync(
      join(process.cwd(), "apps/platform-api/src/db/migrations/033-environment-registry.sql"),
      "utf8"
    );
    await su.query(ddl);

    // 1. Sync the whole ladder from manifests.
    const manifests = STAGES.map(loadManifestDescriptor);
    await syncEnvironmentsFromManifests(deps, operator(), manifests);
    const all = await listEnvironments(deps, operator());
    const ids = new Set(all.map((e) => e.environmentId));
    check(
      "manifest sync projects the whole ladder",
      ["dev", "test", "staging", "prod"].every((s) => ids.has(s)),
      [...ids].join(",")
    );
    check(
      "registerEnvironment emitted an audit event",
      audit.events.some((e) => e.action === "environment.registered"),
      audit.events.filter((e) => e.action === "environment.registered").length + " events"
    );

    // 2. Registry carries no secret-looking value.
    const serialised = JSON.stringify(all);
    const leak = SECRET_VALUE.test(serialised);
    check("registry record carries no secret-looking value", !leak);

    // 3. Mock policy: staging/prod no-mocks; dev/test mocks-allowed.
    const byId = Object.fromEntries(all.map((e) => [e.environmentId, e]));
    check(
      "staging/prod are no-mocks (allowedMocks empty)",
      byId["staging"]?.mockPolicy === "no-mocks" &&
        byId["prod"]?.mockPolicy === "no-mocks" &&
        (byId["staging"]?.allowedMocks.length ?? 1) === 0 &&
        (byId["prod"]?.allowedMocks.length ?? 1) === 0
    );
    check(
      "dev/test are mocks-allowed",
      byId["dev"]?.mockPolicy === "mocks-allowed" && byId["test"]?.mockPolicy === "mocks-allowed"
    );
    check(
      "staging/prod forbid destructive operations",
      byId["staging"]?.destructiveAllowed === false && byId["prod"]?.destructiveAllowed === false
    );

    // 4. Defence-in-depth: a staging manifest with mocks is rejected by the usecase.
    const badStaging: EnvironmentManifestDescriptor = {
      ...loadManifestDescriptor("staging"),
      environmentId: "proof-bad-staging",
      allowedMocks: ["mock-oidc"],
    };
    check(
      "usecase rejects mocks in a staging environment",
      await rejects(() => registerEnvironment(deps, operator(), badStaging))
    );

    // 5. DB CHECK rejects mocks in production via a direct insert.
    check(
      "DB CHECK rejects mock_policy=mocks-allowed in production",
      await rejects(() =>
        su.query(
          `INSERT INTO public.environment_registry (environment_id, name, stage, executor, compose_project, mock_policy)
           VALUES ('proof-bad-prod','x','production','compose','react-x','mocks-allowed')`
        )
      )
    );

    // 6. Permission enforcement.
    check(
      "list without platform.environment.read is Forbidden",
      await rejects(() => listEnvironments(deps, operator([])))
    );
    check(
      "bootstrap without platform.environment.bootstrap is Forbidden",
      await rejects(() =>
        recordBootstrap(deps, operator([ENVIRONMENT_PERMISSIONS.read]), "dev", "bootstrapped")
      )
    );

    // 7. Bootstrap lifecycle stamps last_bootstrapped_at (adapter-confirmed, not faked).
    await recordBootstrap(deps, operator(), "dev", "bootstrapped");
    const dev = await getEnvironment(deps, operator(), "dev");
    check(
      "recordBootstrap stamps last_bootstrapped_at + status",
      dev?.bootstrapStatus === "bootstrapped" && dev?.lastBootstrappedAt != null,
      dev?.lastBootstrappedAt ?? "null"
    );

    // Cleanup proof rows.
    for (const id of ["proof-bad-staging", "proof-bad-prod"]) {
      await su.query("DELETE FROM public.environment_registry WHERE environment_id = $1", [id]);
    }
  } finally {
    await su.end().catch(() => {});
    await app.end().catch(() => {});
  }

  console.log(`\n` + (failures === 0 ? "# PASS" : `# FAIL (${failures})`));
  process.exit(failures === 0 ? 0 : 1);
}

void main();
