#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../../..");
const script = path.join(repoRoot, "tools", "architecture", "generate-package-readmes", "src", "index.mjs");
const fixtureSource = path.join(repoRoot, "tools", "architecture", "generate-package-readmes", "tests", "fixtures", "valid", "app");
const goldenReadme = path.join(repoRoot, "tools", "architecture", "generate-package-readmes", "tests", "fixtures", "golden", "app", "README.md");

function makeFixtureRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "generate-package-readmes-"));
  fs.mkdirSync(path.join(root, "docs", "schemas"), { recursive: true });
  fs.copyFileSync(
    path.join(repoRoot, "docs", "schemas", "package-json-architecture.schema.json"),
    path.join(root, "docs", "schemas", "package-json-architecture.schema.json")
  );
  const target = path.join(root, "packages", "app");
  fs.mkdirSync(target, { recursive: true });
  fs.copyFileSync(path.join(fixtureSource, "package.json"), path.join(target, "package.json"));
  return { root, target };
}

function run(args, cwd = repoRoot) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd,
    encoding: "utf8"
  });
}

const stale = makeFixtureRepo();
const staleResult = run(["--root", stale.root, "--check", "--no-reports", "--format", "json", "packages"]);
assert.equal(staleResult.status, 1, staleResult.stderr || staleResult.stdout);
const stalePayload = JSON.parse(staleResult.stdout);
assert.equal(stalePayload.stale, 1);
assert.equal(fs.existsSync(path.join(stale.target, "README.md")), false);

const written = makeFixtureRepo();
const writeResult = run(["--root", written.root, "--write", "--no-reports", "--format", "json", "packages"]);
assert.equal(writeResult.status, 0, writeResult.stderr || writeResult.stdout);
const writtenPayload = JSON.parse(writeResult.stdout);
assert.equal(writtenPayload.written, 1);
assert.equal(
  fs.readFileSync(path.join(written.target, "README.md"), "utf8"),
  fs.readFileSync(goldenReadme, "utf8")
);

const freshResult = run(["--root", written.root, "--check", "--no-reports", "--format", "json", "packages"]);
assert.equal(freshResult.status, 0, freshResult.stderr || freshResult.stdout);
const freshPayload = JSON.parse(freshResult.stdout);
assert.equal(freshPayload.fresh, 1);
assert.equal(freshPayload.selfEvidencePath, null);


const brokenHeading = makeFixtureRepo();
fs.writeFileSync(path.join(brokenHeading.target, "README.md"), fs.readFileSync(goldenReadme, "utf8").replace("## Governance", "## Broken governance"));
const brokenHeadingResult = run(["--root", brokenHeading.root, "--check", "--no-reports", "--format", "json", "packages"]);
assert.equal(brokenHeadingResult.status, 1, brokenHeadingResult.stderr || brokenHeadingResult.stdout);
const brokenHeadingPayload = JSON.parse(brokenHeadingResult.stdout);
assert.equal(brokenHeadingPayload.stale, 1);
assert.ok(brokenHeadingPayload.results[0].structureErrors.some((error) => error.includes("README missing required heading: ## Governance")));

const manualEdit = makeFixtureRepo();
fs.writeFileSync(path.join(manualEdit.target, "README.md"), fs.readFileSync(goldenReadme, "utf8").replace("## Lifecycle", "Unexpected text\n\n## Lifecycle"));
const manualEditResult = run(["--root", manualEdit.root, "--check", "--no-reports", "--format", "json", "packages"]);
assert.equal(manualEditResult.status, 1, manualEditResult.stderr || manualEditResult.stdout);
const manualEditPayload = JSON.parse(manualEditResult.stdout);
assert.ok(manualEditPayload.results[0].structureErrors.includes("README contains manual edits outside approved extension markers"));

const repair = makeFixtureRepo();
fs.writeFileSync(path.join(repair.target, "README.md"), fs.readFileSync(goldenReadme, "utf8").replace("## Governance", "## Broken governance"));
const repairResult = run(["--root", repair.root, "--write", "--no-reports", "--format", "json", "packages"]);
assert.equal(repairResult.status, 0, repairResult.stderr || repairResult.stdout);
assert.equal(
  fs.readFileSync(path.join(repair.target, "README.md"), "utf8"),
  fs.readFileSync(goldenReadme, "utf8")
);


const validManual = makeFixtureRepo();
const manualNote = "\n\nApproved manual note.\n\n";
fs.writeFileSync(
  path.join(validManual.target, "README.md"),
  fs.readFileSync(goldenReadme, "utf8").replace(
    "<!-- BEGIN MANUAL EXTENSION -->\n\n<!-- END MANUAL EXTENSION -->",
    `<!-- BEGIN MANUAL EXTENSION -->${manualNote}<!-- END MANUAL EXTENSION -->`
  )
);
const validManualResult = run(["--root", validManual.root, "--check", "--no-reports", "--format", "json", "packages"]);
assert.equal(validManualResult.status, 0, validManualResult.stderr || validManualResult.stdout);
const validManualPayload = JSON.parse(validManualResult.stdout);
assert.equal(validManualPayload.fresh, 1);

const preserveManual = makeFixtureRepo();
fs.writeFileSync(
  path.join(preserveManual.target, "README.md"),
  fs.readFileSync(goldenReadme, "utf8")
    .replace("## Governance", "## Broken governance")
    .replace(
      "<!-- BEGIN MANUAL EXTENSION -->\n\n<!-- END MANUAL EXTENSION -->",
      `<!-- BEGIN MANUAL EXTENSION -->${manualNote}<!-- END MANUAL EXTENSION -->`
    )
);
const preserveManualResult = run(["--root", preserveManual.root, "--write", "--no-reports", "--format", "json", "packages"]);
assert.equal(preserveManualResult.status, 0, preserveManualResult.stderr || preserveManualResult.stdout);
const preservedReadme = fs.readFileSync(path.join(preserveManual.target, "README.md"), "utf8");
assert.match(preservedReadme, /Approved manual note\./);
assert.match(preservedReadme, /## Governance/);
assert.doesNotMatch(preservedReadme, /## Broken governance/);
const preserveManualPayload = JSON.parse(preserveManualResult.stdout);
assert.equal(preserveManualPayload.results[0].manualExtensionPreserved, true);

const evidence = makeFixtureRepo();
const evidenceResult = run(["--root", evidence.root, "--write", "--format", "json", "packages"]);
assert.equal(evidenceResult.status, 0, evidenceResult.stderr || evidenceResult.stdout);
const evidencePayload = JSON.parse(evidenceResult.stdout);
assert.match(evidencePayload.selfEvidencePath, /^reports\/tooling\/generate-package-readmes\/.+-run\.json$/);
assert.equal(fs.existsSync(path.join(evidence.root, evidencePayload.selfEvidencePath)), true);


function copyDir(source, target) {
  fs.mkdirSync(target, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const sourcePath = path.join(source, entry.name);
    const targetPath = path.join(target, entry.name);
    if (entry.isDirectory()) {
      copyDir(sourcePath, targetPath);
    } else {
      fs.copyFileSync(sourcePath, targetPath);
    }
  }
}

function assertFileEquals(actual, expected) {
  assert.equal(fs.readFileSync(actual, "utf8"), fs.readFileSync(expected, "utf8"));
}

const representativeRoot = path.join(repoRoot, "tools", "architecture", "generate-package-readmes", "tests", "fixtures", "representative");
const representativeValid = path.join(representativeRoot, "valid");
const representativeGolden = path.join(representativeRoot, "golden");
const representativeWork = fs.mkdtempSync(path.join(os.tmpdir(), "representative-readmes-"));
copyDir(representativeValid, representativeWork);

const representativeResult = run([
  "--root", repoRoot,
  "--write",
  "--no-reports",
  "--format", "json",
  path.relative(repoRoot, representativeWork)
]);
assert.equal(representativeResult.status, 0, representativeResult.stderr || representativeResult.stdout);
const representativePayload = JSON.parse(representativeResult.stdout);
assert.equal(representativePayload.totalPackages, 8);
assert.equal(representativePayload.written, 8);

for (const fixtureName of ["react-app", "feature", "ui", "domain", "graphql-contract", "graphql-adapter", "tooling", "test"]) {
  assertFileEquals(
    path.join(representativeWork, fixtureName, "README.md"),
    path.join(representativeGolden, fixtureName, "README.md")
  );
}

const reactAppReadme = fs.readFileSync(path.join(representativeWork, "react-app", "README.md"), "utf8");
assert.match(reactAppReadme, /React 19/);
assert.match(reactAppReadme, /TypedDocumentNode/);
assert.match(reactAppReadme, /TanStack Query or Apollo Client/);
assert.match(reactAppReadme, /Does not define GraphQL schema contracts/);

const uiReadme = fs.readFileSync(path.join(representativeWork, "ui", "README.md"), "utf8");
assert.match(uiReadme, /Does not fetch GraphQL data/);
assert.match(uiReadme, /UI package is intentionally data-source agnostic/);

const domainReadme = fs.readFileSync(path.join(representativeWork, "domain", "README.md"), "utf8");
assert.match(domainReadme, /Does not render React components/);
assert.match(domainReadme, /Does not execute GraphQL operations/);

const contractReadme = fs.readFileSync(path.join(representativeWork, "graphql-contract", "README.md"), "utf8");
assert.match(contractReadme, /TypedDocumentNode/);
assert.match(contractReadme, /Does not create Apollo Client or TanStack Query clients/);

const adapterReadme = fs.readFileSync(path.join(representativeWork, "graphql-adapter", "README.md"), "utf8");
assert.match(adapterReadme, /GraphQL runtime fetcher/);
assert.match(adapterReadme, /Does not define GraphQL schema contracts/);

const testReadme = fs.readFileSync(path.join(representativeWork, "test", "README.md"), "utf8");
assert.match(testReadme, /MSW GraphQL handlers/);
assert.match(testReadme, /must not be imported by production packages/);

console.log("generate-package-readmes test passed");
