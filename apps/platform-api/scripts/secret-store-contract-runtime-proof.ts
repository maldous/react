/**
 * Secret store CONTRACT live proof (ADR-0069 / ADR-ACT-0265 — Tier-1 kernel).
 *
 * Proves the SecretStorePort contract against the built-in PostgresSecretStore on the
 * local Compose Postgres:
 *  - put returns metadata + an OPAQUE ref, and NEVER the value;
 *  - getMetadata / list expose value-free metadata only (no secret-bearing field);
 *  - resolve() returns the value server-internally (the only value-returning path);
 *  - rotation bumps version and resolve returns the new value;
 *  - revoke disables resolution (returns null) but keeps metadata;
 *  - delete removes the metadata entirely;
 *  - tenant A can never resolve or read tenant B's ref (org-scoped + RLS);
 *  - the value is stored ENCRYPTED at rest (the raw column is not the plaintext);
 *  - put/revoke/delete are audited with the NAME/ref only — never the value;
 *  - readiness reports ready against live Postgres.
 *
 * Requires Postgres. SKIPs honestly (exit 0) if it is unavailable; never fake-PASSes.
 * Usage: npm run proof:secret-store-contract   (requires `make compose-up-default`)
 */

import pg from "pg";
import { loadLocalEnv, requireEnv } from "./lib/local-env.ts";
import type { AuditEvent, AuditEventPort } from "@platform/audit-events";
import { PostgresSecretStore } from "../src/adapters/postgres-secret-store.ts";
import { deleteSecret, listSecrets, putSecret, revokeSecret } from "../src/usecases/secrets.ts";

loadLocalEnv();
const SU_URL = requireEnv("POSTGRES_URL");
const APP_URL = requireEnv("POSTGRES_APP_URL");
const SECRET_FIELD = /secret|password|token|credential|api[_-]?key|private[_-]?key|value/i;
const PLAINTEXT = "s3cr3t-smtp-p@ssw0rd-" + Math.floor(Date.now() / 1000).toString(36);
const ROTATED = "rotated-" + Math.floor(Date.now() / 1000).toString(36);
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

async function main(): Promise<void> {
  console.log("# Secret store CONTRACT live proof (built-in Postgres)\n");
  if (!(await pgReachable(APP_URL))) {
    console.log(
      "SKIP  secret-store-contract proof — Postgres not reachable (`make compose-up-default`)"
    );
    console.log("\n# SKIPPED (no live backend) — not counted as pass or fail");
    process.exit(0);
  }

  const su = new pg.Pool({ connectionString: SU_URL });
  const app = new pg.Pool({ connectionString: APP_URL });
  const store = new PostgresSecretStore(app);
  const audit = capturingAudit();
  const deps = { store, audit: audit.port };

  let orgA: string | null = null;
  let orgB: string | null = null;

  try {
    orgA = (
      await su.query<{ id: string }>(
        "INSERT INTO public.organisations (slug, display_name) VALUES ($1,$2) RETURNING id",
        ["proof-secret-a-" + Date.now().toString(36), "Proof Secret A"]
      )
    ).rows[0]!.id;
    orgB = (
      await su.query<{ id: string }>(
        "INSERT INTO public.organisations (slug, display_name) VALUES ($1,$2) RETURNING id",
        ["proof-secret-b-" + Date.now().toString(36), "Proof Secret B"]
      )
    ).rows[0]!.id;

    // put → opaque ref, never the value
    const summary = await putSecret(
      { organisationId: orgA, name: "smtp/password", value: PLAINTEXT, actor: ACTOR },
      deps
    );
    check("put returns an opaque secret ref", summary.ref.startsWith("secret:"), summary.ref);
    check(
      "put response contains NO secret value",
      !JSON.stringify(summary).includes(PLAINTEXT) && !("value" in (summary as object))
    );
    check(
      "put response is value-free metadata only",
      !SECRET_FIELD.test(Object.keys(summary).join(","))
    );

    // list/getMetadata → value-free
    const listed = await listSecrets(orgA, deps);
    check(
      "list returns the secret metadata without the value",
      listed.secrets.length === 1 &&
        listed.secrets[0]!.ref === summary.ref &&
        !JSON.stringify(listed).includes(PLAINTEXT)
    );
    const meta = await store.getMetadata(orgA, summary.ref);
    check("getMetadata returns metadata, no value", meta != null && !("value" in (meta as object)));

    // resolve → value server-internally
    const resolved = await store.resolve(orgA, summary.ref);
    check("resolve() returns the original value server-internally", resolved === PLAINTEXT);

    // rotation bumps version + resolve returns the new value
    const rot = await putSecret(
      { organisationId: orgA, name: "smtp/password", value: ROTATED, actor: ACTOR },
      deps
    );
    check("rotation bumps version", rot.version === summary.version + 1, `v=${rot.version}`);
    check("rotation keeps the same ref", rot.ref === summary.ref);
    check(
      "resolve returns the rotated value",
      (await store.resolve(orgA, summary.ref)) === ROTATED
    );

    // encrypted at rest — the raw column is not the plaintext
    const raw = await su.query<{ encrypted_value: string | null }>(
      "SELECT encrypted_value FROM public.secret_refs WHERE organisation_id=$1 AND ref=$2",
      [orgA, summary.ref]
    );
    const stored = raw.rows[0]?.encrypted_value ?? "";
    check(
      "value is stored encrypted/escaped at rest (not raw plaintext)",
      stored.length > 0 && !stored.includes(ROTATED) && stored.startsWith("enc:"),
      stored.startsWith("unenc:") ? "WARN: TENANT_SECRET_ENCRYPTION_KEY unset (dev)" : ""
    );

    // tenant isolation: orgB cannot resolve or read orgA's ref
    check(
      "tenant B cannot resolve tenant A's ref",
      (await store.resolve(orgB, summary.ref)) === null
    );
    check(
      "tenant B cannot read tenant A's metadata",
      (await store.getMetadata(orgB, summary.ref)) === null
    );

    // revoke → resolve null, metadata.revoked
    const rev = await revokeSecret({ organisationId: orgA, ref: summary.ref, actor: ACTOR }, deps);
    check("revoke succeeds", rev.kind === "ok");
    check("revoked secret no longer resolves", (await store.resolve(orgA, summary.ref)) === null);
    check(
      "revoked metadata is marked revoked",
      (await store.getMetadata(orgA, summary.ref))?.revoked === true
    );

    // audit carries name/ref but never the value
    const auditOk =
      audit.events.length >= 2 &&
      audit.events.every(
        (e) => !JSON.stringify(e).includes(PLAINTEXT) && !JSON.stringify(e).includes(ROTATED)
      );
    check("audit events carry no secret value", auditOk);

    // delete → metadata gone
    const del = await deleteSecret({ organisationId: orgA, ref: summary.ref, actor: ACTOR }, deps);
    check("delete succeeds", del.kind === "ok");
    check("deleted secret has no metadata", (await store.getMetadata(orgA, summary.ref)) === null);

    // readiness
    const ready = await store.readiness();
    check("built-in store readiness reports ready", ready.status === "ready", ready.detail);
  } catch (err) {
    check("secret store contract proof", false, err instanceof Error ? err.message : String(err));
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
