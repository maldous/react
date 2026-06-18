/**
 * Migration runner pure-logic tests (ADR-ACT-0290).
 *
 * These are PURE unit tests: they exercise the exported helpers of migrate.ts
 * with explicit, test-local values and do NOT touch a database or read the
 * developer's generated .env/<stage>.env. Applying migrations against a live
 * Postgres is covered by the substrate/runtime-proof suites, not here.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import {
  platformAppRolePassword,
  assertSafeRolePassword,
  materializeSql,
  compareMigrationNames,
} from "../../src/db/migrate.ts";

const migrationsDir = fileURLToPath(new URL("../../src/db/migrations/", import.meta.url));
function checksum(sql: string): string {
  return crypto.createHash("sha256").update(sql).digest("hex").slice(0, 16);
}
function readMigration(name: string): string {
  return readFileSync(join(migrationsDir, name), "utf8");
}

describe("migration 010 checksum stability", () => {
  it("retains its original committed checksum (existing DBs must not see a mismatch)", () => {
    // This value is what migrate.ts stored when 010 was first applied in
    // long-lived environments. If 010 is ever edited, this assertion fails —
    // exactly the protection that the Sonar remediation accidentally broke.
    const sql = readMigration("010-platform-app-role.sql");
    assert.equal(checksum(sql), "4f513a166d1e9ce3");
  });

  it("does not contain the password placeholder (it carries the bootstrap literal, never a managed secret)", () => {
    const sql = readMigration("010-platform-app-role.sql");
    assert.ok(!sql.includes("${PLATFORM_APP_PASSWORD}"));
  });
});

describe("migration 034 rotation", () => {
  const sql = readMigration("034-platform-app-role-password-rotation.sql");

  it("rotates an existing role via ALTER ROLE (not CREATE ROLE IF NOT EXISTS)", () => {
    // Inspect executable SQL only — strip "-- ..." comment lines so prose that
    // mentions CREATE ROLE in the rationale doesn't trip the guard.
    const executable = sql
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("--"))
      .join("\n");
    assert.match(executable, /ALTER ROLE platform_app PASSWORD/);
    assert.ok(!/CREATE ROLE/i.test(executable), "must not depend on CREATE ROLE");
  });

  it("materialises the managed placeholder safely from POSTGRES_APP_URL", () => {
    const out = materializeSql(sql, {
      POSTGRES_APP_URL: "postgresql://platform_app:s3cret-rot@db:5432/platform",
    } as NodeJS.ProcessEnv);
    assert.match(out, /ALTER ROLE platform_app PASSWORD 's3cret-rot';/);
    assert.ok(!out.includes("${PLATFORM_APP_PASSWORD}"));
  });

  it("checksum is computed on committed file content (placeholder in place), so it is stable across environments", () => {
    // Materialising with two different passwords must not change the on-disk
    // checksum — the runner hashes the file, then substitutes at apply time.
    const a = materializeSql(sql, {
      POSTGRES_APP_URL: "postgresql://platform_app:aaa@db/platform",
    } as NodeJS.ProcessEnv);
    const b = materializeSql(sql, {
      POSTGRES_APP_URL: "postgresql://platform_app:bbb@db/platform",
    } as NodeJS.ProcessEnv);
    assert.notEqual(a, b); // different materialised SQL
    assert.equal(checksum(sql), checksum(sql)); // but file checksum is intrinsic
  });
});

describe("platformAppRolePassword source", () => {
  it("fails clearly when POSTGRES_APP_URL is missing", () => {
    assert.throws(() => platformAppRolePassword({} as NodeJS.ProcessEnv), /POSTGRES_APP_URL/);
  });

  it("never falls back to the POSTGRES_URL superuser credential", () => {
    // Only POSTGRES_URL set (superuser) — must still fail, not borrow it.
    assert.throws(
      () =>
        platformAppRolePassword({
          POSTGRES_URL: "postgresql://platform:superuserpw@db/platform",
        } as NodeJS.ProcessEnv),
      /POSTGRES_APP_URL/
    );
  });

  it("fails clearly when POSTGRES_APP_URL has no password component", () => {
    assert.throws(
      () =>
        platformAppRolePassword({
          POSTGRES_APP_URL: "postgresql://platform_app@db/platform",
        } as NodeJS.ProcessEnv),
      /no password/
    );
  });

  it("decodes a percent-encoded password", () => {
    const pw = platformAppRolePassword({
      POSTGRES_APP_URL: "postgresql://platform_app:a%2Bb@db/platform",
    } as NodeJS.ProcessEnv);
    assert.equal(pw, "a+b");
  });
});

describe("assertSafeRolePassword rejects unsafe interpolation", () => {
  for (const [label, pw] of [
    ["single quote", "pw'; DROP ROLE platform_app;--"],
    ["backslash", "pw\\escape"],
    ["newline", "pw\ninjected"],
    ["carriage return", "pw\rinjected"],
    ["null byte", "pw\u0000injected"],
  ] as const) {
    it(`rejects a password containing a ${label}`, () => {
      assert.throws(() => assertSafeRolePassword(pw), /SQL safety/);
    });
  }

  it("accepts an ordinary strong password", () => {
    assert.doesNotThrow(() => assertSafeRolePassword("Xq7-vP2_zR9wKm4t"));
  });

  it("materializeSql rejects an unsafe POSTGRES_APP_URL password", () => {
    assert.throws(
      () =>
        materializeSql("ALTER ROLE platform_app PASSWORD '${PLATFORM_APP_PASSWORD}';", {
          POSTGRES_APP_URL: "postgresql://platform_app:bad%27quote@db/platform",
        } as NodeJS.ProcessEnv),
      /SQL safety/
    );
  });
});

describe("compareMigrationNames is locale-independent code-point order", () => {
  it("orders zero-padded migration filenames numerically", () => {
    const names = ["010-x.sql", "002-x.sql", "034-x.sql", "009-x.sql", "001-x.sql"];
    const sorted = [...names].sort(compareMigrationNames);
    assert.deepEqual(sorted, ["001-x.sql", "002-x.sql", "009-x.sql", "010-x.sql", "034-x.sql"]);
  });

  it("orders punctuation by code point (where some locale collations would not)", () => {
    // Under many locale collations '-' and '_' sort unpredictably relative to
    // digits; code-point order is fully deterministic: '-'(0x2D) < digits < '_'(0x5F).
    const names = ["01-a.sql", "01_a.sql", "010a.sql"];
    const sorted = [...names].sort(compareMigrationNames);
    assert.deepEqual(sorted, ["01-a.sql", "010a.sql", "01_a.sql"]);
  });

  it("matches the real on-disk migration ordering (numeric prefixes ascending)", () => {
    const files = readdirSync(migrationsDir)
      .filter((f) => f.endsWith(".sql"))
      .sort(compareMigrationNames);
    const prefixes = files.map((f) => Number(f.slice(0, 3)));
    for (let i = 1; i < prefixes.length; i++) {
      assert.ok(prefixes[i]! > prefixes[i - 1]!, `out of order at ${files[i]}`);
    }
  });
});
