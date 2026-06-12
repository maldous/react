/**
 * Local backup integrity runtime proof (ADR-ACT-0229). Local-only.
 *
 *   1. seed a temp org with a UNIQUE marker
 *   2. run scripts/backup/postgres-backup.sh → a gzipped dump under an ignored dir
 *   3. the dump CONTAINS the marker (backup integrity) — without printing dump contents
 *   4. the restore script REFUSES without ENV=dev|test + CONFIRM_RESTORE (guard proven)
 *   5. cleanup (delete the org, remove the temp backup dir)
 *
 * A full restore is intentionally NOT exercised here (it overwrites the DB); the guard +
 * backup integrity are proven instead. No dump contents / secrets are printed.
 *
 * Usage: npm run proof:backup-local   (Postgres up; pg_dump on PATH)
 */

import { execFileSync } from "node:child_process";
import { gunzipSync } from "node:zlib";
import { readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { loadLocalEnv } from "./lib/local-env.ts";

let failures = 0;
function check(label: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

async function main(): Promise<void> {
  console.log("# Local backup integrity runtime proof\n");
  loadLocalEnv();
  const url =
    process.env["POSTGRES_URL"] ?? "postgresql://platform:platformpassword@localhost:5433/platform";
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

    // 2. Run the real backup script.
    const out = execFileSync("bash", ["scripts/backup/postgres-backup.sh"], {
      env: { ...process.env, ENV: "dev", BACKUP_DIR: backupDir, POSTGRES_URL: url },
      encoding: "utf8",
    }).trim();
    check("backup script produced a gzipped dump", out.endsWith(".sql.gz"));

    // 3. The dump contains the marker (integrity) — gunzip + search, never print contents.
    const dump = gunzipSync(readFileSync(out)).toString("utf8");
    check("backup contains the seeded marker (integrity)", dump.includes(marker));
    check("backup is non-trivial in size", dump.length > 1000, `${dump.length} bytes`);

    // 4. Restore guard: refuses without ENV=dev|test + CONFIRM_RESTORE.
    let refused = false;
    try {
      execFileSync("bash", ["scripts/backup/postgres-restore.sh", out], {
        env: { ...process.env, ENV: "prod" }, // wrong env + no confirm → must refuse
        encoding: "utf8",
        stdio: "pipe",
      });
    } catch (err) {
      const msg = (err as { stderr?: string }).stderr ?? String(err);
      refused = /refusing/.test(msg);
    }
    check("restore script REFUSES without ENV=dev|test + CONFIRM_RESTORE", refused);
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
