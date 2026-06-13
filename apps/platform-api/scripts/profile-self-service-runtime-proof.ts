/**
 * Profile self-service LIVE Postgres proof (ADR-0068 / ADR-ACT-0260).
 *
 * Proves against the local Compose Postgres: a user reads/updates ONLY their own
 * profile (a second user's profile is independent); display-name validation;
 * RLS tenant isolation (a foreign-tenant context sees 0 of a tenant's profiles);
 * no secret-bearing columns.
 *
 * Runs repos as platform_app (RLS enforces). Creates + cleans up its own orgs.
 * SKIPs honestly (exit 0) if Postgres is unavailable; never fake-PASSes.
 *
 * Usage: npm run proof:profile-self-service   (requires `make compose-up-default`)
 */

import pg from "pg";
import { loadLocalEnv } from "./lib/local-env.ts";
import { withTenant } from "@platform/adapters-postgres";
import type { AuditEventPort } from "@platform/audit-events";
import { PostgresProfileRepository } from "../src/adapters/postgres-profile-repository.ts";
import { getMyProfile, updateMyProfile } from "../src/usecases/profile.ts";

loadLocalEnv();
const SU_URL =
  process.env["POSTGRES_URL"] ?? "postgresql://platform:platformpassword@localhost:5433/platform";
const APP_URL =
  process.env["POSTGRES_APP_URL"] ??
  "postgresql://platform_app:platformapppassword@localhost:5433/platform";
const SECRET_FIELD = /secret|password|token|credential|api[_-]?key|private[_-]?key/i;
const noopAudit: AuditEventPort = { emit: async () => {}, query: async () => [] };

let failures = 0;
function check(label: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
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
  console.log("# Profile self-service LIVE Postgres proof\n");
  if (!(await reachable(APP_URL))) {
    console.log("SKIP  profile proof — Postgres not reachable (run `make compose-up-default`)");
    console.log("\n# SKIPPED (no live Postgres) — not counted as pass or fail");
    process.exit(0);
  }

  const su = new pg.Pool({ connectionString: SU_URL });
  const app = new pg.Pool({ connectionString: APP_URL });
  const profiles = new PostgresProfileRepository(app);
  const deps = { profiles, audit: noopAudit };
  const actor = (userId: string) => ({ actorId: userId, actorRoles: ["tenant-admin"] });
  let orgA: string | null = null;
  let orgB: string | null = null;

  try {
    const cols = await su.query<{ c: string }>(
      "SELECT column_name AS c FROM information_schema.columns WHERE table_schema='public' AND table_name='user_profiles'"
    );
    check(
      "user_profiles has no secret-bearing columns",
      !cols.rows.some((r) => SECRET_FIELD.test(r.c))
    );

    orgA = (
      await su.query<{ id: string }>(
        "INSERT INTO public.organisations (slug, display_name) VALUES ($1,$2) RETURNING id",
        ["proof-prof-a-" + Date.now().toString(36), "Proof Prof A"]
      )
    ).rows[0]!.id;
    orgB = (
      await su.query<{ id: string }>(
        "INSERT INTO public.organisations (slug, display_name) VALUES ($1,$2) RETURNING id",
        ["proof-prof-b-" + Date.now().toString(36), "Proof Prof B"]
      )
    ).rows[0]!.id;

    // defaults when none saved
    const def = await getMyProfile(orgA, "user-1", deps);
    check(
      "returns defaults when no profile saved",
      def.displayName === "" && def.locale === "en-GB"
    );

    // validation: empty display name
    let threw = false;
    try {
      await updateMyProfile(
        {
          organisationId: orgA,
          userId: "user-1",
          displayName: "  ",
          locale: "en-GB",
          timezone: "UTC",
          actor: actor("user-1"),
        },
        deps
      );
    } catch {
      threw = true;
    }
    check("empty display name rejected", threw);

    // user-1 updates own profile
    await updateMyProfile(
      {
        organisationId: orgA,
        userId: "user-1",
        displayName: "Ada",
        locale: "en-GB",
        timezone: "Europe/London",
        actor: actor("user-1"),
      },
      deps
    );
    check(
      "user reads back their own updated profile",
      (await getMyProfile(orgA, "user-1", deps)).displayName === "Ada"
    );
    // user-2's profile is independent (own-profile-only by session userId)
    check(
      "a different user's profile is independent",
      (await getMyProfile(orgA, "user-2", deps)).displayName === ""
    );

    // RLS isolation: orgB tenant context sees 0 of orgA's profiles
    const crossCount = await withTenant(app as never, orgB, async (client) => {
      const r = await client.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM public.user_profiles WHERE organisation_id=$1",
        [orgA]
      );
      return Number(r.rows[0]?.n ?? "0");
    });
    check("RLS hides orgA's profiles from orgB's tenant context (count = 0)", crossCount === 0);
  } catch (err) {
    check("live profile proof", false, err instanceof Error ? err.message : String(err));
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
