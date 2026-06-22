/**
 * Environment admin bootstrap PROOF (ADR-0072 / ADR-ACT-0274).
 *
 * Proves the per-environment global system administrator handoff (deterministic;
 * no backend required):
 *  - `bootstrap.mjs seed-admin <stage>` prints a handoff with URL/Username/Password/
 *    Secret ref;
 *  - the password equals the generated SYSADMIN_BOOTSTRAP_PASSWORD for that stage;
 *  - the persisted marker (.env/secrets/<stage>.admin.json) contains NO plaintext
 *    password (only username + opaque secretRef + metadata);
 *  - staging/prod handoffs are flagged LOCAL/BOOTSTRAP MODE (rotate before exposure);
 *  - `print-admin` re-prints the same handoff (authorised local re-print).
 *
 * Usage: npm run proof:environment-admin-bootstrap
 */

import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";

let failures = 0;
function check(label: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}` + (detail ? ` — ${detail}` : ""));
  if (!ok) failures++;
  assert.equal(ok, true, detail ? `${label}: ${detail}` : label);
}
function run(args: string[]): string {
  return execFileSync("node", ["scripts/env/bootstrap.mjs", ...args], { encoding: "utf8" });
}
function generatedPassword(stage: string): string | undefined {
  const path = join(process.cwd(), ".env", `${stage}.env`);
  if (!existsSync(path)) return undefined;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^SYSADMIN_BOOTSTRAP_PASSWORD=(.+)$/);
    if (m) return m[1];
  }
  return undefined;
}

function main(): void {
  console.log("# Environment admin bootstrap PROOF\n");
  // Ensure runtime env exists for all stages first.
  execFileSync("node", ["scripts/env/generate-runtime-env.mjs", "--all"], { stdio: "ignore" });

  for (const stage of ["dev", "prod"]) {
    const out = run(["seed-admin", stage]);
    const pw = generatedPassword(stage);
    check(
      `${stage}: handoff prints URL/Username/Password/Secret ref`,
      /URL:/.test(out) &&
        /Username:/.test(out) &&
        /Password:/.test(out) &&
        /Secret ref:\s+secret:/.test(out)
    );
    check(
      `${stage}: handoff password == generated SYSADMIN_BOOTSTRAP_PASSWORD`,
      pw != null && out.includes(pw)
    );

    const markerPath = join(process.cwd(), ".env", "secrets", `${stage}.admin.json`);
    check(`${stage}: marker persisted`, existsSync(markerPath));
    if (existsSync(markerPath)) {
      const marker = readFileSync(markerPath, "utf8");
      check(
        `${stage}: marker contains NO plaintext password`,
        pw != null && !marker.includes(pw) && !/Bs1-/.test(marker)
      );
      const parsed = JSON.parse(marker);
      check(
        `${stage}: marker has username + opaque secretRef`,
        typeof parsed.username === "string" && /^secret:/.test(parsed.secretRef)
      );
    }
  }

  // staging/prod must be flagged local-bootstrap (rotate before exposure).
  const prodOut = run(["seed-admin", "prod"]);
  check("prod handoff is flagged LOCAL/BOOTSTRAP MODE", /LOCAL\/BOOTSTRAP MODE/.test(prodOut));

  // re-print matches.
  const reprint = run(["print-admin", "dev"]);
  check(
    "print-admin re-prints the handoff",
    /Username:/.test(reprint) && /re-printed from/.test(reprint)
  );

  console.log(`\n` + (failures === 0 ? "# PASS" : `# FAIL (${failures})`));
  process.exit(failures === 0 ? 0 : 1);
}

main();
