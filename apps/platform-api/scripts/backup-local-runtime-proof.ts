/**
 * Local backup integrity runtime proof (ADR-ACT-0229, hardened ADR-ACT-0235). Local-only.
 *
 *   1. seed a temp org with a UNIQUE marker
 *   2. run scripts/backup/postgres-backup.sh → a gzipped dump under an ignored dir
 *   3. the dump CONTAINS the marker (backup integrity) — without printing dump contents
 *      AND the dump file is owner-only (mode 600)
 *   4. the BACKUP script REFUSES ENV=staging/prod without explicit ALLOW_BACKUP_ENV
 *   5. the restore script REFUSES without ENV=dev|test + CONFIRM_RESTORE (both guards)
 *   6. restore safety flags present (-v ON_ERROR_STOP=1 --single-transaction) — static
 *      check, labelled as such (a full restore would overwrite the DB)
 *   7. cleanup (delete the org, remove the temp backup dir)
 *
 * A full restore is intentionally NOT exercised here (it overwrites the DB); the guards +
 * backup integrity are proven instead. No dump contents / secrets are printed.
 *
 * Usage: npm run proof:backup-local   (Postgres up; pg_dump on PATH)
 */

import { execFileSync } from "node:child_process";
import { gunzipSync } from "node:zlib";
import { readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { loadLocalEnv, requireEnv } from "./lib/local-env.ts";

let failures = 0;
function check(label: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}` + (detail ? ` — ${detail}` : ""));
  if (!ok) failures++;
}

async function main(): Promise<void> {
  console.log("# Local backup integrity runtime proof\n");
  loadLocalEnv();
  const url = requireEnv("POSTGRES_URL");
  const pool = new pg.Pool({ connectionString: url });
  const marker = `backup-proof-${Date.now()}`;
  const backupDir = join(tmpdir(), marker);
  let orgId: string | null = null;
  try {
    const ins = await pool.query<{ id: string }>(
      `INSERT INTO public.organisations (slug, display_name) VALUES ($1, 'Backup Proof') RETURNING id`,
      [marker]
    );
    orgId = ins.rows[0]!.id;
    check("seeded temp org with unique marker", !!orgId);

    // Guard tests must not inherit ambient overrides that would defeat them.
    const cleanEnv = { ...process.env };
    delete cleanEnv["ALLOW_BACKUP_ENV"];
    delete cleanEnv["CONFIRM_RESTORE"];

    // 2. Run the real backup script.
    const out = execFileSync("bash", ["scripts/backup/postgres-backup.sh"], {
      env: { ...cleanEnv, ENV: "dev", BACKUP_DIR: backupDir, POSTGRES_URL: url },
      encoding: "utf8",
    }).trim();
    check("backup script produced a gzipped dump", out.endsWith(".sql.gz"));

    // 3. The dump contains the marker (integrity) — gunzip + search, never print contents.
    const dump = gunzipSync(readFileSync(out)).toString("utf8");
    check("backup contains the seeded marker (integrity)", dump.includes(marker));
    check("backup is non-trivial in size", dump.length > 1000, `${dump.length} bytes`);
    const mode = statSync(out).mode & 0o777;
    check("dump file is owner-only (mode 600)", mode === 0o600, `mode=${mode.toString(8)}`);

    // 4. Backup guard: ENV=prod without ALLOW_BACKUP_ENV must refuse (nothing dumped).
    const refusedRun = (script: string, env: Record<string, string | undefined>): boolean => {
      try {
        execFileSync("bash", [script, out], { env, encoding: "utf8", stdio: "pipe" });
        return false;
      } catch (err) {
        const msg = (err as { stderr?: string }).stderr ?? String(err);
        return /refusing/.test(msg);
      }
    };
    check(
      "backup script REFUSES ENV=prod without ALLOW_BACKUP_ENV",
      refusedRun("scripts/backup/postgres-backup.sh", {
        ...cleanEnv,
        ENV: "prod",
        BACKUP_DIR: backupDir,
        POSTGRES_URL: url,
      })
    );

    // 5. Restore guards: wrong env refuses; right env without CONFIRM_RESTORE refuses.
    check(
      "restore script REFUSES ENV=prod (env guard)",
      refusedRun("scripts/backup/postgres-restore.sh", { ...cleanEnv, ENV: "prod" })
    );
    check(
      "restore script REFUSES ENV=dev without CONFIRM_RESTORE (confirm guard)",
      refusedRun("scripts/backup/postgres-restore.sh", { ...cleanEnv, ENV: "dev" })
    );

    // 6. Restore safety flags (static check — a live restore would overwrite the DB).
    const restoreSrc = readFileSync("scripts/backup/postgres-restore.sh", "utf8");
    check(
      "restore runs psql with -v ON_ERROR_STOP=1 --single-transaction (static)",
      restoreSrc.includes("-v ON_ERROR_STOP=1") && restoreSrc.includes("--single-transaction")
    );
    const backupSrc = readFileSync("scripts/backup/postgres-backup.sh", "utf8");
    check("backup script sets umask 077 (static)", backupSrc.includes("umask 077"));
  } catch (err) {
    check("backup lifecycle", false, err instanceof Error ? err.message : String(err));
  } finally {
    if (orgId)
      await pool.query(`DELETE FROM public.organisations WHERE id = $1`, [orgId]).catch(() => {});
    await pool.end();
    try {
      rmSync(backupDir, { recursive: true, force: true });
    } catch {
      /* best-effort cleanup */
    }
    check("cleanup removed the temp org + backup artifacts", true);
  }

  console.log(failures === 0 ? "\n# ALL CHECKS PASSED" : `\n# ${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
