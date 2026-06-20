// Live gate: runs the harness validator over the REAL ui-capability-model.json, feeding it the
// real harness source tree (bespoke-code check) and the repo package scripts (proof-command check).
// This is the schema/cross-reference enforcement for harness-enabled capabilities — it fails the
// build if any harness definition is internally inconsistent or ships bespoke per-capability code.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateHarnessDefinitions } from "../src/validate-definition.mjs";
import { harnessCapabilityKeys } from "../src/load-capability.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, "../../..");
const srcDir = path.join(here, "../src");

const model = JSON.parse(
  fs.readFileSync(path.join(repoRoot, "docs/v2-foundation/ui-capability-model.json"), "utf8")
);
const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));

// Capability keys explicitly permitted to ship bespoke harness code (none — the harness is generic).
const BESPOKE_EXCEPTIONS = [];

function listSourceFiles(dir, base = dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listSourceFiles(full, base));
    else out.push(path.relative(base, full).split(path.sep).join("/"));
  }
  return out;
}

test("every harness-enabled capability in the real model is internally consistent", () => {
  const findings = validateHarnessDefinitions(model.capabilities || [], {
    sourceFiles: listSourceFiles(srcDir),
    packageScripts: pkg.scripts || {},
    exceptions: BESPOKE_EXCEPTIONS,
  });
  assert.deepEqual(
    findings,
    [],
    `harness definition findings:\n${findings.map((f) => `${f.capabilityKey}: ${f.message}`).join("\n")}`
  );
});

test("the generic renderer tree contains no file named after a capability key", () => {
  const keys = new Set(harnessCapabilityKeys(model));
  const offenders = listSourceFiles(srcDir).filter((rel) => {
    const stem = (rel.split("/").pop() || "").replace(/\.(tsx?|mjs|jsx?)$/i, "");
    return keys.has(stem) && !BESPOKE_EXCEPTIONS.includes(stem);
  });
  assert.deepEqual(offenders, [], `bespoke capability files: ${offenders.join(", ")}`);
});
