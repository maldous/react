/**
 * Typed two-tier secret-resolution live proof (V1C-CONF-04; ADR-0069 + ADR-0076).
 *
 * Proves the real composition sequence against the local built-in secret store:
 *   loadBootstrapSecretConfig (Tier-0 root of trust, env/file, explicit provider)
 *     → createSecretStoreFromBootstrap (store built FROM bootstrap, no implicit fallback)
 *       → putSecret (Tier-1 managed secret → opaque SecretRef)
 *         → resolveManagedSecret (resolves the ref through the bootstrap-built store)
 *           → rotate → resolve new value → old value no longer active.
 *
 * Every secret VALUE is kept redacted in the output. Requires Postgres; SKIPs honestly (exit 0)
 * if unavailable — never fake-PASSes. Usage: npm run proof:typed-secret-resolution
 */
import pg from "pg";
import { loadLocalEnv, requireEnv } from "./lib/local-env.ts";
import type { AuditEvent, AuditEventPort } from "@platform/audit-events";
import { putSecret } from "../src/usecases/secrets.ts";
import {
  loadBootstrapSecretConfig,
  createSecretStoreFromBootstrap,
  resolveManagedSecret,
  bootstrapMetadata,
  type SecretRef,
} from "../src/config/bootstrap-secrets.ts";

loadLocalEnv();
const SU_URL = requireEnv("POSTGRES_URL");
const APP_URL = requireEnv("POSTGRES_APP_URL");
const V1 = "kc-secret-" + Math.floor(Date.now() / 1000).toString(36);
const V2 = "kc-rotated-" + Math.floor(Date.now() / 1000).toString(36);
const ACTOR = { actorId: "00000000-0000-0000-0000-000000000000", actorRoles: ["system-admin"] };

let failures = 0;
const check = (label: string, ok: boolean, detail = ""): void => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};
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
  console.log("# Typed two-tier secret-resolution live proof\n");
  if (!(await pgReachable(APP_URL))) {
    console.log(
      "SKIP  typed-secret-resolution proof — Postgres not reachable (`make compose-up-default`)"
    );
    console.log("\n# SKIPPED (no live backend) — not counted as pass or fail");
    process.exit(0);
  }
  const su = new pg.Pool({ connectionString: SU_URL });
  const app = new pg.Pool({ connectionString: APP_URL });
  try {
    // Tier-0: load the bootstrap root of trust (explicit provider, no fallback) and build the store.
    const bootstrap = loadBootstrapSecretConfig();
    check(
      "Tier-0 bootstrap resolves an explicit provider",
      bootstrap.provider === "builtin" || bootstrap.provider === "openbao",
      bootstrap.provider
    );
    check(
      "bootstrap metadata is value-free (presence + provider only)",
      bootstrapMetadata(bootstrap).every(
        (m) => m.secretTier === "bootstrap" && typeof m.present === "boolean"
      )
    );
    const store = await createSecretStoreFromBootstrap(app, bootstrap);
    const ready = await store.readiness();
    check(
      "store built from bootstrap is ready",
      ready.status === "ready",
      `${ready.provider}/${ready.status}`
    );

    const audit = capturingAudit();
    const deps = { store, audit: audit.port };
    const org = (
      await su.query<{ id: string }>(
        "INSERT INTO public.organisations (slug, display_name) VALUES ($1,$2) RETURNING id",
        ["proof-typed-secret-" + Date.now().toString(36), "Proof Typed Secret"]
      )
    ).rows[0]!.id;

    // Tier-1: put a managed secret → opaque ref; resolve THROUGH the bootstrap-built store.
    const summary = await putSecret(
      { organisationId: org, name: "keycloak/client-secret", value: V1, actor: ACTOR },
      deps
    );
    const ref = summary.ref as SecretRef;
    check("managed secret has an opaque SecretRef", ref.startsWith("secret:"), ref);
    const resolved = await resolveManagedSecret(store, org, ref, {
      required: true,
      field: "keycloakClientSecret",
    });
    check("resolveManagedSecret returns the value via the bootstrap-built store", resolved === V1);

    // rotate → resolve new value → old value no longer active.
    const rot = await putSecret(
      { organisationId: org, name: "keycloak/client-secret", value: V2, actor: ACTOR },
      deps
    );
    check("rotation bumps the version", rot.version === summary.version + 1, `v=${rot.version}`);
    const after = await resolveManagedSecret(store, org, ref, {
      required: true,
      field: "keycloakClientSecret",
    });
    check("resolve returns the rotated value", after === V2);
    check("the previous value is no longer active", after !== V1);

    // required managed secret with no ref fails closed; optional disabled capability returns null.
    let failedClosed = false;
    try {
      await resolveManagedSecret(store, org, undefined, {
        required: true,
        field: "keycloakClientSecret",
      });
    } catch {
      failedClosed = true;
    }
    check("required managed secret with no SecretRef fails closed", failedClosed);
    check(
      "optional/disabled managed secret returns null",
      (await resolveManagedSecret(store, org, undefined, { required: false, field: "stripe" })) ===
        null
    );

    // redaction: no secret value appears anywhere in the captured audit
    const auditJson = JSON.stringify(audit.events);
    check("audit captures NO secret value", !auditJson.includes(V1) && !auditJson.includes(V2));

    await su.query("DELETE FROM public.organisations WHERE id=$1", [org]).catch(() => {});
  } finally {
    await su.end().catch(() => {});
    await app.end().catch(() => {});
  }

  console.log(`\n# ${failures === 0 ? "PASS" : "FAIL"} — ${failures} failure(s)`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
