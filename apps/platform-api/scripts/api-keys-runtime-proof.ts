/**
 * API keys LIVE Postgres proof (ADR-0065 / ADR-ACT-0257).
 *
 * Proves the API-key substrate against the local Compose Postgres:
 *  - the plaintext secret is returned exactly once on creation (sk_ prefix);
 *  - only a salted+peppered hash is stored — the stored hash cannot authenticate
 *    as the plaintext, and no list/read ever returns the secret or the hash;
 *  - creation is entitlement-gated (`api_access`, deny-by-default);
 *  - a valid secret authenticates; a revoked key is denied;
 *  - keys are tenant-scoped (RLS): tenant B never sees tenant A's keys;
 *  - operator (rls_bypass) can list a target tenant's keys.
 *
 * Runs repos as platform_app (RLS enforces). Creates + cleans up its own orgs.
 * SKIPs honestly (exit 0) if Postgres is unavailable; never fake-PASSes.
 *
 * Usage: npm run proof:api-keys   (requires `make compose-up-default`)
 */

import pg from "pg";
import { loadLocalEnv, requireEnv } from "./lib/local-env.ts";
import { withTenant } from "@platform/adapters-postgres";
import type { AuditEventPort } from "@platform/audit-events";
import { PostgresApiKeyRepository } from "../src/adapters/postgres-api-key-repository.ts";
import { PostgresEntitlementRepository } from "../src/adapters/postgres-entitlement-repository.ts";
import {
  authenticateApiKey,
  createApiKey,
  listApiKeys,
  revokeApiKey,
} from "../src/usecases/api-keys.ts";

loadLocalEnv();
const SU_URL = requireEnv("POSTGRES_URL");
const APP_URL = requireEnv("POSTGRES_APP_URL");
const SECRET_FIELD = /secret|password|credential|private[_-]?key|plaintext/i;

const noopAudit: AuditEventPort = { emit: async () => {}, query: async () => [] };
const ACTOR = { actorId: "00000000-0000-0000-0000-000000000000", actorRoles: ["tenant-admin"] };

let failures = 0;
function check(label: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}` + (detail ? ` — ${detail}` : ""));
  if (!ok) failures++;
}
async function reachable(url: string): Promise<boolean> {
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
  console.log("# API keys LIVE Postgres proof\n");
  if (!(await reachable(APP_URL))) {
    console.log("SKIP  api-keys proof — Postgres not reachable (run `make compose-up-default`)");
    console.log("\n# SKIPPED (no live Postgres) — not counted as pass or fail");
    process.exit(0);
  }

  const su = new pg.Pool({ connectionString: SU_URL });
  const app = new pg.Pool({ connectionString: APP_URL });
  const apiKeys = new PostgresApiKeyRepository(app);
  const entitlements = new PostgresEntitlementRepository(app);
  const deps = { apiKeys, entitlements, audit: noopAudit };
  let orgA: string | null = null;
  let orgB: string | null = null;

  try {
    // no plaintext-secret-bearing columns (the hash + salt are fine; the secret is not stored)
    const cols = await su.query<{ c: string }>(
      "SELECT column_name AS c FROM information_schema.columns WHERE table_schema='public' AND table_name='api_keys'"
    );
    check(
      "api_keys stores no plaintext secret column",
      !cols.rows.some((r) => SECRET_FIELD.test(r.c)),
      cols.rows.map((r) => r.c).join(",")
    );

    orgA = (
      await su.query<{ id: string }>(
        "INSERT INTO public.organisations (slug, display_name) VALUES ($1,$2) RETURNING id",
        ["proof-key-a-" + Date.now().toString(36), "Proof Key A"]
      )
    ).rows[0]!.id;
    orgB = (
      await su.query<{ id: string }>(
        "INSERT INTO public.organisations (slug, display_name) VALUES ($1,$2) RETURNING id",
        ["proof-key-b-" + Date.now().toString(36), "Proof Key B"]
      )
    ).rows[0]!.id;

    // grant api_access to A only
    await entitlements.upsert({
      organisationId: orgA,
      entitlementKey: "api_access",
      state: "granted",
      source: "system",
      updatedBy: "op",
    });

    // creation denied for B (not entitled)
    const denied = await createApiKey({ organisationId: orgB, name: "b", actor: ACTOR }, deps);
    check(
      "key creation denied when tenant lacks api_access entitlement",
      denied.kind === "not_entitled"
    );

    // creation for A: secret returned once
    const created = await createApiKey(
      { organisationId: orgA, name: "ci-token", scopes: ["read"], actor: ACTOR },
      deps
    );
    check("key creation returns the plaintext secret once", created.kind === "ok");
    if (created.kind !== "ok") throw new Error("creation failed");
    const secret = created.response.secret;
    check(
      "secret has the sk_ prefix + secretShownOnce flag",
      secret.startsWith("sk_") && created.response.secretShownOnce === true
    );

    // list never returns the secret or the hash
    const listed = await listApiKeys(orgA, deps);
    const listJson = JSON.stringify(listed);
    check(
      "list returns the created key",
      listed.apiKeys.some((k) => k.id === created.response.apiKey.id)
    );
    check("list response carries no secret", !listJson.includes(secret));
    check(
      "list response carries no hash/salt fields",
      !/keyHash|keySalt|key_hash|key_salt/.test(listJson)
    );

    // valid secret authenticates → orgA
    const auth = await authenticateApiKey(secret, deps);
    check("a valid secret authenticates to the owning tenant", auth?.organisationId === orgA);

    // the stored hash cannot authenticate as the plaintext
    const hashRow = await su.query<{ key_hash: string }>(
      "SELECT key_hash FROM public.api_keys WHERE key_prefix=$1",
      [created.response.apiKey.keyPrefix]
    );
    const storedHash = hashRow.rows[0]!.key_hash;
    check(
      "the stored hash cannot authenticate as the plaintext",
      (await authenticateApiKey(storedHash, deps)) === null
    );

    // tenant scoping (RLS): orgB's tenant context sees zero api_keys
    const crossCount = await withTenant(app as never, orgB, async (client) => {
      const r = await client.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM public.api_keys"
      );
      return Number(r.rows[0]?.n ?? "0");
    });
    check("RLS hides orgA's keys from orgB's tenant context (count = 0)", crossCount === 0);

    // operator list sees orgA's key
    const opList = await listApiKeys(orgA, deps, { operator: true });
    check("operator (rls_bypass) can list a tenant's keys", opList.apiKeys.length >= 1);

    // revoke → authentication denied
    const rev = await revokeApiKey(
      { organisationId: orgA, keyId: created.response.apiKey.id, actor: ACTOR },
      deps
    );
    check("revoke succeeds", rev.kind === "ok");
    check(
      "a revoked key no longer authenticates",
      (await authenticateApiKey(secret, deps)) === null
    );
  } catch (err) {
    check("live api-keys proof", false, err instanceof Error ? err.message : String(err));
  } finally {
    if (orgA)
      await su.query("DELETE FROM public.organisations WHERE id=$1", [orgA]).catch(() => {});
    if (orgB)
      await su.query("DELETE FROM public.organisations WHERE id=$1", [orgB]).catch(() => {});
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
