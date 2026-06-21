/**
 * PITR/restore drill runtime proof.
 *
 * Uses the local backup script to capture a dump from the platform database, then
 * restores that dump into a throwaway Postgres container and verifies the marker.
 * This proves the restore path without touching the live platform database.
 */

import { execFileSync } from "node:child_process";
import { gunzipSync } from "node:zlib";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { loadLocalEnv, requireEnv } from "./lib/local-env.ts";

async function main(): Promise<void> {
  loadLocalEnv();
  const url = requireEnv("POSTGRES_URL");
  const marker = `pitr-proof-${Date.now()}`;
  const backupDir = join(tmpdir(), `pitr-${randomUUID()}`);

  const live = new pg.Pool({ connectionString: url });
  let orgId: string | null = null;
  let containerId: string | null = null;
  try {
    const ins = await live.query<{ id: string }>(
      `INSERT INTO public.organisations (slug, display_name) VALUES ($1, 'PITR Proof') RETURNING id`,
      [marker]
    );
    orgId = ins.rows[0]!.id;
    await live.query(`UPDATE public.organisations SET display_name = $1 WHERE id = $2`, [
      marker,
      orgId,
    ]);

    const dumpPath = execFileSync("bash", ["scripts/backup/postgres-backup.sh"], {
      env: { ...process.env, ENV: "dev", POSTGRES_URL: url, BACKUP_DIR: backupDir },
      encoding: "utf8",
    }).trim();

    const dump = gunzipSync(readFileSync(dumpPath)).toString("utf8");
    if (!dump.includes(marker)) {
      throw new Error("backup marker missing");
    }

    containerId = execFileSync(
      "docker",
      [
        "run",
        "-d",
        "--rm",
        "-e",
        "POSTGRES_PASSWORD=restorepassword",
        "-e",
        "POSTGRES_USER=restore",
        "-e",
        "POSTGRES_DB=restore",
        "-p",
        "55432:5432",
        "postgres:16-alpine",
      ],
      { encoding: "utf8" }
    ).trim();

    const restoreUrl = "postgresql://restore:restorepassword@localhost:55432/restore";
    await new Promise((resolve) => setTimeout(resolve, 15000));
    execFileSync("bash", ["scripts/backup/postgres-restore.sh", dumpPath], {
      env: { ...process.env, ENV: "dev", CONFIRM_RESTORE: "restore-dev", POSTGRES_URL: restoreUrl },
      encoding: "utf8",
      stdio: "pipe",
    });

    const restored = new pg.Pool({ connectionString: restoreUrl });
    try {
      const found = await restored.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM public.organisations WHERE display_name = $1",
        [marker]
      );
      if (Number(found.rows[0]?.n ?? "0") !== 1) {
        throw new Error("restored marker not found");
      }
    } finally {
      await restored.end().catch(() => {});
    }

    console.log(
      JSON.stringify(
        {
          capability: "V2 PITR restore drill",
          result: "PASSED",
          marker,
          dumpPath,
        },
        null,
        2
      )
    );
  } finally {
    if (orgId)
      await live.query("DELETE FROM public.organisations WHERE id=$1", [orgId]).catch(() => {});
    await live.end().catch(() => {});
    if (containerId) {
      try {
        execFileSync("docker", ["rm", "-f", containerId], { encoding: "utf8" });
      } catch {}
    }
    rmSync(backupDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
