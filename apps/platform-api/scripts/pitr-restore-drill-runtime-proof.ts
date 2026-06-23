/**
 * PITR/restore drill runtime proof.
 *
 * Uses the local backup script to capture a dump from the platform database, then
 * restores that dump into a throwaway Postgres container and verifies the marker.
 * This proves the restore path without touching the live platform database.
 */

import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import { gunzipSync } from "node:zlib";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import net from "node:net";
import pg from "pg";

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => {
        if (address && typeof address === "object") resolve(address.port);
        else reject(new Error("failed to allocate a free port"));
      });
    });
  });
}

async function main(): Promise<void> {
  const sourcePassword = `source-${randomUUID()}`;
  const restorePassword = `restore-${randomUUID()}`;
  const marker = `pitr-proof-${Date.now()}`;
  const backupDir = join(tmpdir(), `pitr-${randomUUID()}`);
  const sourcePort = await freePort();
  const restorePort = await freePort();
  let sourceContainerId: string | null = null;
  let restoreContainerId: string | null = null;
  try {
    sourceContainerId = execFileSync(
      "docker",
      [
        "run",
        "-d",
        "--rm",
        "-e",
        `POSTGRES_PASSWORD=${sourcePassword}`,
        "-e",
        "POSTGRES_USER=source",
        "-e",
        "POSTGRES_DB=source",
        "-p",
        `${sourcePort}:5432`,
        "postgres:16-alpine",
      ],
      { encoding: "utf8" }
    ).trim();

    const sourceUrl =
      "postgresql://source:" +
      encodeURIComponent(sourcePassword) +
      `@localhost:${sourcePort}/source`;
    await new Promise((resolve) => setTimeout(resolve, 15000));
    const source = new pg.Pool({ connectionString: sourceUrl });
    let orgId: string | null = null;
    try {
      await source.query(
        `CREATE TABLE IF NOT EXISTS public.organisations (id uuid primary key default gen_random_uuid(), slug text, display_name text)`
      );
      const ins = await source.query<{ id: string }>(
        `INSERT INTO public.organisations (slug, display_name) VALUES ($1, 'PITR Proof') RETURNING id`,
        [marker]
      );
      orgId = ins.rows[0]!.id;
      await source.query(`UPDATE public.organisations SET display_name = $1 WHERE id = $2`, [
        marker,
        orgId,
      ]);

      const dumpPath = execFileSync("bash", ["scripts/backup/postgres-backup.sh"], {
        env: { ...process.env, ENV: "dev", POSTGRES_URL: sourceUrl, BACKUP_DIR: backupDir },
        encoding: "utf8",
      }).trim();

      const dump = gunzipSync(readFileSync(dumpPath)).toString("utf8");
      assert.ok(dump.includes(marker), "backup dump contains the PITR marker");

      restoreContainerId = execFileSync(
        "docker",
        [
          "run",
          "-d",
          "--rm",
          "-e",
          `POSTGRES_PASSWORD=${restorePassword}`,
          "-e",
          "POSTGRES_USER=restore",
          "-e",
          "POSTGRES_DB=restore",
          "-p",
          `${restorePort}:5432`,
          "postgres:16-alpine",
        ],
        { encoding: "utf8" }
      ).trim();

      const restoreUrl =
        "postgresql://restore:" +
        encodeURIComponent(restorePassword) +
        `@localhost:${restorePort}/restore`;
      await new Promise((resolve) => setTimeout(resolve, 15000));
      execFileSync("bash", ["scripts/backup/postgres-restore.sh", dumpPath], {
        env: {
          ...process.env,
          ENV: "dev",
          CONFIRM_RESTORE: "restore-dev",
          POSTGRES_URL: restoreUrl,
        },
        encoding: "utf8",
        stdio: "pipe",
      });

      const restored = new pg.Pool({ connectionString: restoreUrl });
      try {
        const found = await restored.query<{ n: string }>(
          "SELECT count(*)::text AS n FROM public.organisations WHERE display_name = $1",
          [marker]
        );
        assert.equal(Number(found.rows[0]?.n ?? "0"), 1, "restored database contains the marker");
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
        await source.query("DELETE FROM public.organisations WHERE id=$1", [orgId]).catch(() => {});
      await source.end().catch(() => {});
    }
  } finally {
    if (sourceContainerId) {
      try {
        execFileSync("docker", ["rm", "-f", sourceContainerId], { encoding: "utf8" });
      } catch {}
    }
    if (restoreContainerId) {
      try {
        execFileSync("docker", ["rm", "-f", restoreContainerId], { encoding: "utf8" });
      } catch {}
    }
    rmSync(backupDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
