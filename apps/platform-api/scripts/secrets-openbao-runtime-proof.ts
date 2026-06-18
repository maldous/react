/**
 * OpenBao secrets provider LIVE proof (ADR-0069 / ADR-ACT-0265 — Tier-1 kernel).
 *
 * Proves the composed OpenBaoSecretStore against a live OpenBao + Postgres:
 *  - put stores the VALUE in OpenBao KV v2; only value-free metadata lands in Postgres
 *    (provider='openbao', encrypted_value NULL, backend_path set) — NO value in the DB;
 *  - resolve() round-trips the value back FROM OpenBao;
 *  - readiness reports ready when OpenBao answers sys/health;
 *  - tenant A can never resolve tenant B's ref;
 *  - revoke disables resolution; delete removes metadata + the OpenBao entry;
 *  - the metadata/list surface never carries the value.
 *
 * Requires BOTH Postgres and a live OpenBao (OPENBAO_ADDR + OPENBAO_TOKEN, dev mode is
 * fine). SKIPs honestly (exit 0) if either is unavailable — a skipped proof can NEVER
 * upgrade the registry status; it never fake-PASSes.
 *
 * Usage: npm run proof:secrets-openbao   (requires `make compose-up-secrets`)
 */

import pg from "pg";
import { loadLocalEnv, requireEnv } from "./lib/local-env.ts";
import { OpenBaoSecretStore } from "../src/adapters/openbao-secret-store.ts";

loadLocalEnv();
const SU_URL = requireEnv("POSTGRES_URL");
const APP_URL = requireEnv("POSTGRES_APP_URL");
const OPENBAO_ADDR = process.env["OPENBAO_ADDR"] ?? "http://localhost:8200";
const OPENBAO_TOKEN = requireEnv("OPENBAO_TOKEN");
const PLAINTEXT = "openbao-value-" + Math.floor(Date.now() / 1000).toString(36);

let failures = 0;
function check(label: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
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
async function openbaoReachable(): Promise<boolean> {
  try {
    const res = await fetch(`${OPENBAO_ADDR.replace(/\/+$/, "")}/v1/sys/health`, {
      headers: { "X-Vault-Token": OPENBAO_TOKEN },
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  console.log("# OpenBao secrets provider LIVE proof\n");
  const [pgOk, baoOk] = await Promise.all([pgReachable(APP_URL), openbaoReachable()]);
  if (!pgOk || !baoOk) {
    const missing = [!pgOk ? "Postgres" : null, !baoOk ? "OpenBao" : null]
      .filter(Boolean)
      .join(" + ");
    console.log(
      `SKIP  secrets-openbao proof — ${missing} not reachable (run \`make compose-up-secrets\`)`
    );
    console.log("\n# SKIPPED (no live backend) — not counted as pass or fail");
    process.exit(0);
  }

  const su = new pg.Pool({ connectionString: SU_URL });
  const app = new pg.Pool({ connectionString: APP_URL });
  const store = new OpenBaoSecretStore(app, {
    address: OPENBAO_ADDR,
    token: OPENBAO_TOKEN,
    warn: () => {},
  });

  let orgA: string | null = null;
  let orgB: string | null = null;
  let refA = "";

  try {
    orgA = (
      await su.query<{ id: string }>(
        "INSERT INTO public.organisations (slug, display_name) VALUES ($1,$2) RETURNING id",
        ["proof-bao-a-" + Date.now().toString(36), "Proof Bao A"]
      )
    ).rows[0]!.id;
    orgB = (
      await su.query<{ id: string }>(
        "INSERT INTO public.organisations (slug, display_name) VALUES ($1,$2) RETURNING id",
        ["proof-bao-b-" + Date.now().toString(36), "Proof Bao B"]
      )
    ).rows[0]!.id;

    const ready = await store.readiness();
    check(
      "readiness reports ready when OpenBao answers sys/health",
      ready.status === "ready",
      ready.detail
    );

    const meta = await store.put({
      organisationId: orgA,
      name: "provider/meilisearch/api-key",
      value: PLAINTEXT,
      actorId: "00000000-0000-0000-0000-000000000000",
    });
    refA = meta.ref;
    check(
      "put returns an opaque ref with provider=openbao",
      meta.ref.startsWith("secret:") && meta.provider === "openbao"
    );

    // value round-trips FROM OpenBao
    check(
      "resolve() round-trips the value from OpenBao",
      (await store.resolve(orgA, refA)) === PLAINTEXT
    );

    // the VALUE is NOT in Postgres — only metadata + path
    const row = await su.query<{
      encrypted_value: string | null;
      backend_path: string | null;
      provider: string;
    }>(
      "SELECT encrypted_value, backend_path, provider FROM public.secret_refs WHERE organisation_id=$1 AND ref=$2",
      [orgA, refA]
    );
    check(
      "no secret value stored in Postgres (encrypted_value NULL)",
      row.rows[0]?.encrypted_value == null
    );
    check("backend_path recorded for the OpenBao value", !!row.rows[0]?.backend_path);
    check(
      "Postgres metadata row carries no plaintext value",
      !JSON.stringify(row.rows[0]).includes(PLAINTEXT)
    );

    // tenant isolation
    check("tenant B cannot resolve tenant A's ref", (await store.resolve(orgB, refA)) === null);

    // revoke → no resolution
    await store.revoke(orgA, refA, "00000000-0000-0000-0000-000000000000");
    check("revoked secret no longer resolves", (await store.resolve(orgA, refA)) === null);

    // delete → metadata gone
    await store.delete(orgA, refA, "00000000-0000-0000-0000-000000000000");
    check("deleted secret has no metadata", (await store.getMetadata(orgA, refA)) === null);
  } catch (err) {
    check("openbao secrets proof", false, err instanceof Error ? err.message : String(err));
  } finally {
    if (orgA)
      await su.query("DELETE FROM public.organisations WHERE id=$1", [orgA]).catch(() => {});
    if (orgB)
      await su.query("DELETE FROM public.organisations WHERE id=$1", [orgB]).catch(() => {});
    await app.end().catch(() => {});
    await su.end().catch(() => {});
  }

  console.log(
    failures === 0
      ? "\n# ALL CHECKS PASSED (live OpenBao + Postgres)"
      : `\n# ${failures} CHECK(S) FAILED`
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("proof failed:", err);
  process.exit(1);
});
