// ADR-ACT-0290 (Option B) — SonarQube OIDC honesty guard.
//
// SonarQube Community Build 25.9 has no native OIDC and the OIDC plugin is NOT
// bundled here, so SonarQube uses native managed auth behind the forward-auth
// gate. These tests fail if the docs/script regress to falsely claiming SSO is
// wired/verified, or if provision-oidc.sh loses its "don't claim success when
// the plugin is absent" gate.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (rel) => readFileSync(resolve(repoRoot, rel), "utf8");

test("provision-oidc.sh gates on the plugin actually being installed", () => {
  const sh = read("scripts/sonar/provision-oidc.sh");
  assert.match(sh, /oidc_plugin_installed/, "must check plugin installation");
  assert.match(sh, /api\/plugins\/installed/, "must query the installed-plugins API");
  // When the plugin is absent it must state native auth and NOT claim SSO.
  assert.match(sh, /native managed auth behind the forward-auth gate/i);
});

test("the SSO matrix marks SonarQube as native-auth, not 'wired + verified'", () => {
  const matrix = read("docs/evidence/platform/composed-service-sso-matrix.md");
  const sonarRow = matrix.split("\n").find((l) => /\*\*SonarQube\*\*/.test(l));
  assert.ok(sonarRow, "SonarQube row present");
  assert.match(sonarRow, /Native auth behind forward-auth/);
  assert.ok(
    !/Wired \+ verified/.test(sonarRow),
    "SonarQube must not be marked 'Wired + verified' — OIDC is not delivered"
  );
});

test("the matrix no longer claims the incompatible v2.1.1 plugin was loaded", () => {
  const matrix = read("docs/evidence/platform/composed-service-sso-matrix.md");
  // The historical false claim was "plugin authoidc 2.1.1 loaded" in the live
  // verification section. It must be corrected (OIDC NOT active).
  assert.match(matrix, /OIDC NOT active/);
});
