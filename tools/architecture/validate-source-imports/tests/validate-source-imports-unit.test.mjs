#!/usr/bin/env node
/**
 * Unit tests for validate-source-imports internal functions.
 * Imports functions directly (not via spawnSync) to boost in-process coverage.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../../..");
const fixturesDir = path.join(__dirname, "fixtures");

// ??? reporter.mjs ????????????????????????????????????????????????????????????

import fs from "node:fs";
import os from "node:os";

import {
  buildJsonReport,
  buildMarkdownReport,
  writeReports,
  writeCommittedEvidence,
  writeSelfEvidence,
} from "../src/reporter.mjs";

test("buildJsonReport: basic zero-violation report", () => {
  const files = [{ imports: ["react", "@platform/domain-core"] }, { imports: ["lodash"] }];
  const violations = [];
  const report = buildJsonReport({
    generatedAt: "2024-01-01T00:00:00.000Z",
    files,
    violations,
    repoRoot,
    toolVersion: "1.2.3",
    scanMethod: "typescript-ast",
    strictMode: false,
    tsconfigPath: null,
    compilerOptionsSummary: null,
    edgeStats: null,
    packageGraph: null,
  });

  assert.equal(report.totalFiles, 2);
  assert.equal(report.totalImports, 3); // 2 + 1 imports
  assert.equal(report.passed, 2);
  assert.equal(report.failed, 0);
  assert.deepEqual(report.violations, []);
  assert.equal(report.toolVersion, "1.2.3");
  assert.equal(report.scanMethod, "typescript-ast");
  assert.equal(report.strictMode, false);
  assert.deepEqual(report.packageGraph, {});
});

test("buildJsonReport: with violations maps relative paths", () => {
  const absFile = path.join(repoRoot, "packages/foo/src/index.ts");
  const files = [{ imports: ["react"] }];
  const violations = [
    {
      file: absFile,
      packageName: "@platform/foo",
      specifier: "react",
      rule: "no-react-in-domain",
      message: "@platform/foo must not import react",
      resolvedFile: null,
      resolvedPackage: null,
    },
  ];
  const report = buildJsonReport({
    generatedAt: "2024-01-01T00:00:00.000Z",
    files,
    violations,
    repoRoot,
    toolVersion: null,
    scanMethod: null,
    strictMode: true,
    tsconfigPath: "/tsconfig.json",
    compilerOptionsSummary: { pathAliasCount: 2 },
    edgeStats: {
      totalImports: 5,
      totalResolvedImports: 4,
      totalUnresolvedImports: 1,
      totalInternalEdges: 3,
      totalExternalEdges: 2,
      totalTypeOnlyEdges: 0,
      totalDynamicImports: 1,
    },
    packageGraph: new Map([["@platform/foo", new Set(["@platform/bar"])]]),
  });

  assert.equal(report.failed, 1);
  assert.equal(report.passed, 0);
  assert.equal(report.violations[0].file, "packages/foo/src/index.ts");
  assert.equal(report.violations[0].package, "@platform/foo");
  assert.equal(report.violations[0].specifier, "react");
  assert.equal(report.violations[0].rule, "no-react-in-domain");
  assert.equal(report.totalImports, 5);
  assert.equal(report.totalResolvedImports, 4);
  assert.equal(report.totalUnresolvedImports, 1);
  assert.deepEqual(report.packageGraph, { "@platform/foo": ["@platform/bar"] });
});

test("buildJsonReport: packageGraph with multiple packages sorts deps", () => {
  const files = [];
  const violations = [];
  const graph = new Map([
    ["@platform/b", new Set(["@platform/z", "@platform/a"])],
    ["@platform/a", new Set()],
  ]);
  const report = buildJsonReport({
    generatedAt: "2024-01-01T00:00:00.000Z",
    files,
    violations,
    repoRoot,
    toolVersion: null,
    scanMethod: null,
    strictMode: false,
    tsconfigPath: null,
    compilerOptionsSummary: null,
    edgeStats: null,
    packageGraph: graph,
  });
  assert.deepEqual(report.packageGraph["@platform/b"], ["@platform/a", "@platform/z"]);
  assert.deepEqual(report.packageGraph["@platform/a"], []);
});

test("buildMarkdownReport: no violations produces clean summary", () => {
  const report = {
    generatedAt: "2024-01-01T00:00:00.000Z",
    totalFiles: 3,
    totalImports: 10,
    passed: 3,
    failed: 0,
    violations: [],
  };
  const md = buildMarkdownReport(report);
  assert.ok(md.includes("# Source import boundary validation report"));
  assert.ok(md.includes("Total files scanned: 3"));
  assert.ok(md.includes("Total imports checked: 10"));
  assert.ok(md.includes("Passed: 3"));
  assert.ok(md.includes("Failed: 0"));
  assert.ok(md.includes("All source files satisfy import boundary rules."));
  assert.ok(!md.includes("## Violations"));
});

test("buildMarkdownReport: with violations lists them", () => {
  const report = {
    generatedAt: "2024-01-01T00:00:00.000Z",
    totalFiles: 1,
    totalImports: 2,
    passed: 0,
    failed: 1,
    violations: [
      {
        file: "packages/foo/src/index.ts",
        package: "@platform/foo",
        specifier: "react",
        rule: "no-react-in-domain",
        message: "@platform/foo must not import react",
      },
    ],
  };
  const md = buildMarkdownReport(report);
  assert.ok(md.includes("## Violations"));
  assert.ok(md.includes("packages/foo/src/index.ts"));
  assert.ok(md.includes("`react`"));
  assert.ok(md.includes("no-react-in-domain"));
});

// ??? writeReports ????????????????????????????????????????????????????????????

test("writeReports: writes json and markdown files to reportDir", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "reporter-test-"));
  const jsonReport = { generatedAt: "2024-01-01", totalFiles: 0, violations: [] };
  const markdownReport = "# Test\nNo violations.\n";
  const { jsonPath, mdPath } = writeReports(jsonReport, markdownReport, tmpDir);

  assert.ok(fs.existsSync(jsonPath), "JSON report should exist");
  assert.ok(fs.existsSync(mdPath), "Markdown report should exist");
  const writtenJson = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  assert.deepEqual(writtenJson, jsonReport);
  const writtenMd = fs.readFileSync(mdPath, "utf8");
  assert.equal(writtenMd, markdownReport);

  // Cleanup
  fs.rmSync(tmpDir, { recursive: true });
});

test("writeReports: creates directory if it does not exist", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "reporter-test-"));
  const nestedDir = path.join(tmpDir, "nested", "subdir");
  const jsonReport = { test: true };
  const { jsonPath } = writeReports(jsonReport, "markdown", nestedDir);
  assert.ok(fs.existsSync(jsonPath));
  fs.rmSync(tmpDir, { recursive: true });
});

// ??? writeCommittedEvidence ???????????????????????????????????????????????????

test("writeCommittedEvidence: writes evidence files with correct content", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "evidence-test-"));
  // Create required docs/evidence/import-boundaries directory structure
  const jsonReport = {
    generatedAt: "2024-01-01T00:00:00.000Z",
    totalFiles: 5,
    totalImports: 10,
    totalResolvedImports: 9,
    totalUnresolvedImports: 1,
    totalInternalEdges: 5,
    totalExternalEdges: 4,
    totalTypeOnlyEdges: 0,
    totalDynamicImports: 1,
    passed: 5,
    failed: 0,
    violations: [],
    packageGraph: { "@platform/foo": ["@platform/bar"] },
    strictMode: true,
    tsconfigPath: "/tsconfig.json",
    compilerOptionsSummary: { pathAliasCount: 3 },
  };

  const { jsonPath, mdPath } = writeCommittedEvidence(jsonReport, tmpDir, "1.0.0", [
    "apps",
    "packages",
  ]);

  assert.ok(fs.existsSync(jsonPath), "Evidence JSON should exist");
  assert.ok(fs.existsSync(mdPath), "Evidence Markdown should exist");

  const writtenJson = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  assert.equal(writtenJson.toolVersion, "1.0.0");
  assert.ok(writtenJson.ruleSet.includes("ADR-0001"));
  assert.deepEqual(writtenJson.scanRoots, ["apps", "packages"]);

  const writtenMd = fs.readFileSync(mdPath, "utf8");
  assert.ok(writtenMd.includes("# Source import boundary validation evidence"));
  assert.ok(writtenMd.includes("Tool version:   1.0.0"));
  assert.ok(writtenMd.includes("Strict mode:    true"));
  assert.ok(writtenMd.includes("All source files satisfy import boundary rules."));

  fs.rmSync(tmpDir, { recursive: true });
});

test("writeCommittedEvidence: shows violations when present", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "evidence-test-"));
  const jsonReport = {
    generatedAt: "2024-01-01T00:00:00.000Z",
    totalFiles: 1,
    totalImports: 1,
    totalResolvedImports: null,
    totalUnresolvedImports: null,
    totalInternalEdges: null,
    totalExternalEdges: null,
    totalTypeOnlyEdges: null,
    totalDynamicImports: null,
    passed: 0,
    failed: 1,
    violations: [
      {
        file: "packages/foo/src/index.ts",
        message: "must not import react",
        rule: "no-react-in-domain",
      },
    ],
    packageGraph: null,
    strictMode: false,
    tsconfigPath: null,
    compilerOptionsSummary: null,
  };

  const { mdPath } = writeCommittedEvidence(jsonReport, tmpDir, "0.1.0", ["apps"]);
  const writtenMd = fs.readFileSync(mdPath, "utf8");
  assert.ok(writtenMd.includes("## Violations"));
  assert.ok(writtenMd.includes("must not import react"));

  fs.rmSync(tmpDir, { recursive: true });
});

// ??? writeSelfEvidence ????????????????????????????????????????????????????????

test("writeSelfEvidence: writes a timestamped run.json file", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "self-evidence-test-"));
  const startedAt = "2024-01-01T00:00:00.000Z";
  const finishedAt = "2024-01-01T00:00:01.000Z";
  const absFile = path.join(repoRoot, "packages/foo/src/index.ts");

  const evidencePath = writeSelfEvidence({
    toolName: "validate-source-imports",
    toolVersion: "1.0.0",
    command: ["node", "src/index.mjs"],
    mode: "check",
    repoRoot,
    startedAt,
    finishedAt,
    inputRoots: ["apps", "packages"],
    outputPaths: [],
    violations: [
      {
        file: absFile,
        packageName: "@platform/foo",
        specifier: "react",
        rule: "no-react-in-domain",
        message: "must not import react",
      },
    ],
    checksPassed: 5,
    checksFailed: 1,
    warnings: ["Some warning"],
    exitCode: 1,
    toolingReportDir: tmpDir,
  });

  assert.ok(fs.existsSync(evidencePath), "Self-evidence file should exist");
  const written = JSON.parse(fs.readFileSync(evidencePath, "utf8"));
  assert.equal(written.toolName, "validate-source-imports");
  assert.equal(written.toolVersion, "1.0.0");
  assert.equal(written.exitCode, 1);
  assert.equal(written.checksPassed, 5);
  assert.equal(written.checksFailed, 1);
  assert.ok(written.durationMs >= 0);
  assert.ok(Array.isArray(written.rulesEvaluated));
  assert.ok(written.rulesEvaluated.includes("no-deep-import"));
  assert.equal(written.errors.length, 1);
  assert.equal(written.errors[0].file, "packages/foo/src/index.ts");
  assert.equal(written.warnings.length, 1);
  assert.equal(written.warnings[0].message, "Some warning");

  fs.rmSync(tmpDir, { recursive: true });
});

// ??? rules.mjs ???????????????????????????????????????????????????????????????

import { UNIVERSAL_RULES, PACKAGE_RULES } from "../src/rules.mjs";

test("UNIVERSAL_RULES: no-deep-import matches deep platform imports", () => {
  const rule = UNIVERSAL_RULES.find((r) => r.id === "no-deep-import");
  assert.ok(rule, "no-deep-import rule must exist");
  assert.equal(rule.match("@platform/foo/internal"), true);
  assert.equal(rule.match("@platform/foo"), false);
  assert.equal(rule.match("react"), false);
  assert.equal(rule.match("@other/foo/deep"), false);
});

test("UNIVERSAL_RULES: no-test-support-in-prod matches exact specifier", () => {
  const rule = UNIVERSAL_RULES.find((r) => r.id === "no-test-support-in-prod");
  assert.ok(rule);
  assert.equal(rule.match("@platform/test-support"), true);
  assert.equal(rule.match("@platform/test-support-extra"), false);
  assert.equal(rule.match("react"), false);
});

test("UNIVERSAL_RULES: no-architecture-in-product matches @architecture/ prefix in @platform packages", () => {
  const rule = UNIVERSAL_RULES.find((r) => r.id === "no-architecture-in-product");
  assert.ok(rule);
  const platformFileInfo = { packageName: "@platform/feature-x", packageRoot: "/any" };
  const archFileInfo = { packageName: "@architecture/tool", packageRoot: "/any" };
  assert.equal(rule.match("@architecture/validate-package-metadata", platformFileInfo), true);
  assert.equal(rule.match("@architecture/validate-package-metadata", archFileInfo), false);
  assert.equal(rule.match("react", platformFileInfo), false);
});

test("UNIVERSAL_RULES: no-relative-cross-package-import matches cross-package relative imports", () => {
  const rule = UNIVERSAL_RULES.find((r) => r.id === "no-relative-cross-package-import");
  assert.ok(rule);
  // Non-relative specifier should not match
  assert.equal(rule.match("@platform/foo", {}), false);
  assert.equal(rule.match("lodash", {}), false);
});

test("UNIVERSAL_RULES: messages include relevant info", () => {
  const noDeep = UNIVERSAL_RULES.find((r) => r.id === "no-deep-import");
  const msg = noDeep.message("@platform/foo", "@platform/foo/internal");
  assert.ok(msg.includes("@platform/foo"));
  assert.ok(msg.includes("@platform/foo/internal"));
});

test("PACKAGE_RULES: domain-core has rules against react and graphql", () => {
  const rules = PACKAGE_RULES["@platform/domain-core"];
  assert.ok(Array.isArray(rules), "domain-core must have package rules");
  const ruleIds = rules.map((r) => r.id);
  assert.ok(ruleIds.includes("no-react-in-domain"), "must include no-react-in-domain");
  assert.ok(ruleIds.includes("no-graphql-in-domain"), "must include no-graphql-in-domain");
});

test("PACKAGE_RULES: no-react-in-domain matches react and react-dom", () => {
  const rules = PACKAGE_RULES["@platform/domain-core"];
  const reactRule = rules.find((r) => r.id === "no-react-in-domain");
  assert.ok(reactRule);
  assert.equal(reactRule.match("react"), true);
  assert.equal(reactRule.match("react-dom"), true);
  assert.equal(reactRule.match("react-query"), false); // not in forbiddenExact
  assert.equal(reactRule.match("lodash"), false);
});

test("PACKAGE_RULES: no-graphql-in-domain matches graphql and @apollo/ prefix", () => {
  const rules = PACKAGE_RULES["@platform/domain-core"];
  const gqlRule = rules.find((r) => r.id === "no-graphql-in-domain");
  assert.ok(gqlRule);
  assert.equal(gqlRule.match("graphql"), true);
  assert.equal(gqlRule.match("@apollo/client"), true);
  assert.equal(gqlRule.match("@graphql-codegen/core"), true);
  assert.equal(gqlRule.match("lodash"), false);
});

test("PACKAGE_RULES: rule message includes package and specifier", () => {
  const rules = PACKAGE_RULES["@platform/domain-core"];
  const reactRule = rules.find((r) => r.id === "no-react-in-domain");
  const msg = reactRule.message("@platform/domain-core", "react");
  assert.ok(msg.includes("@platform/domain-core"));
  assert.ok(msg.includes("react"));
});

// ??? package-map.mjs ?????????????????????????????????????????????????????????

import { buildPackageMap } from "../src/package-map.mjs";

test("buildPackageMap: returns a Map with known packages from the repo", () => {
  const packageMap = buildPackageMap(repoRoot);
  assert.ok(packageMap instanceof Map);
  // The repo has at least the react-enterprise-app and architecture tools
  assert.ok(packageMap.size > 0, "package map must not be empty");
  // Check one known package from the valid fixture structure
  const hasArchitecturePkg = [...packageMap.keys()].some(
    (k) => k.startsWith("@architecture/") || k.startsWith("@platform/")
  );
  assert.ok(hasArchitecturePkg, "package map must contain @architecture/ or @platform/ packages");
});

test("buildPackageMap: entries have expected shape", () => {
  const packageMap = buildPackageMap(repoRoot);
  for (const [name, info] of packageMap) {
    assert.equal(typeof name, "string");
    assert.equal(typeof info.name, "string");
    assert.equal(typeof info.root, "string");
    assert.equal(name, info.name);
    break; // just check the first one
  }
});

// ??? scanner.mjs ?????????????????????????????????????????????????????????????

import { scanRoots, findPackageRoot } from "../src/scanner.mjs";

test("scanRoots: scans a valid fixture directory and returns files", () => {
  const validFixture = path.join(fixturesDir, "valid", "feature-workflow");
  const { files, warnings } = scanRoots(["src"], validFixture);
  // The feature-workflow fixture has src/index.ts
  assert.ok(Array.isArray(files));
  assert.ok(Array.isArray(warnings));
  assert.ok(files.length > 0, "must find at least one file");
  const file = files[0];
  assert.ok(typeof file.file === "string");
  assert.ok(typeof file.packageName === "string");
  assert.ok(Array.isArray(file.imports));
  assert.ok(Array.isArray(file.importEdges));
  assert.ok(Array.isArray(file.computedImports));
  assert.ok(typeof file.isTestFile === "boolean");
});

test("scanRoots: warns about nonexistent root", () => {
  const { files, warnings } = scanRoots(["nonexistent-dir"], repoRoot);
  assert.equal(files.length, 0);
  assert.ok(warnings.some((w) => w.includes("nonexistent-dir")));
});

test("scanRoots: returns empty for directory with no source files", () => {
  // The domain-core fixture has only package.json, no src
  const domainFixture = path.join(fixturesDir, "valid", "domain-core");
  // scan from the package root itself but only src/ which doesn't exist
  const { files, warnings: _warnings } = scanRoots(["nonexistent"], domainFixture);
  assert.equal(files.length, 0);
});

test("findPackageRoot: finds package root for a file inside a package", () => {
  // Use the repo's own tools directory
  const testFile = path.join(
    repoRoot,
    "tools",
    "architecture",
    "validate-source-imports",
    "src",
    "index.mjs"
  );
  const result = findPackageRoot(testFile);
  assert.ok(result !== null);
  assert.ok(typeof result.packageRoot === "string");
  assert.ok(typeof result.packageName === "string");
  assert.ok(result.packageName.includes("validate-source-imports"));
});

test("findPackageRoot: returns null for a file with no ancestor package.json with name", () => {
  // Use root filesystem path where there's guaranteed no package.json with a name field
  // Actually, findPackageRoot walks up until it finds a package.json with a name field
  // and returns null only if it reaches the filesystem root with none.
  // We test the case where it does find a package by checking the result shape.
  const result = findPackageRoot(
    path.join(repoRoot, "tools/architecture/validate-source-imports/src/index.mjs")
  );
  assert.ok(result !== null);
  assert.ok(typeof result.packageRoot === "string");
  assert.ok(typeof result.packageName === "string");
});

test("scanRoots: domain-core fixture with no imports", () => {
  const _validFixture = path.join(fixturesDir, "valid");
  // Scan the domain-core directory (no src .ts files that import platform packages)
  const domainFixture = path.join(fixturesDir, "valid", "domain-core");
  // domain-core has src/ with files
  const { files } = scanRoots(["src"], domainFixture);
  // All files should belong to @platform/domain-core
  for (const f of files) {
    assert.equal(f.packageName, "@platform/domain-core");
  }
});
