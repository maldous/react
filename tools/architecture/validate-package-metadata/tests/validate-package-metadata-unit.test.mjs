#!/usr/bin/env node
/**
 * Unit tests for validate-package-metadata internal functions.
 * Imports functions directly (not via spawnSync) to boost in-process coverage.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../../..");

import {
  parseArgs,
  findRepoRoot,
  isObject,
  validateArchitectureGroups,
  validatePackage,
  validateComponent,
  validateLifecycle,
  validateGovernance,
  validateRuntime,
  validateBoundaries,
  validateRelations,
  validateTags,
  validateReadme,
  validateLifecycleGovernanceConsistency,
  validateTagProjection,
  applySchemaValidation,
  REQUIRED_ARCHITECTURE_GROUPS,
  listPackageJsonFiles,
} from "../src/index.mjs";

// ??? parseArgs ???????????????????????????????????????????????????????????????

test("parseArgs: defaults", () => {
  const opts = parseArgs([]);
  assert.equal(opts.format, "text");
  assert.equal(opts.noReports, false);
  assert.equal(opts.strict, false);
  assert.equal(opts.allowMissingAjv, false);
  assert.equal(opts.root, null);
  assert.deepEqual(opts.roots, []);
});

test("parseArgs: --format json", () => {
  const opts = parseArgs(["--format", "json"]);
  assert.equal(opts.format, "json");
});

test("parseArgs: --no-reports sets flag", () => {
  const opts = parseArgs(["--no-reports"]);
  assert.equal(opts.noReports, true);
});

test("parseArgs: --strict sets flag", () => {
  const opts = parseArgs(["--strict"]);
  assert.equal(opts.strict, true);
});

test("parseArgs: --allow-missing-ajv sets flag", () => {
  const opts = parseArgs(["--allow-missing-ajv"]);
  assert.equal(opts.allowMissingAjv, true);
});

test("parseArgs: --root sets root", () => {
  const opts = parseArgs(["--root", "/some/path"]);
  assert.equal(opts.root, "/some/path");
});

test("parseArgs: --check and --write are ignored (consumed)", () => {
  const opts = parseArgs(["--check"]);
  assert.equal(opts.format, "text"); // no change
  const opts2 = parseArgs(["--write"]);
  assert.equal(opts2.format, "text");
});

test("parseArgs: positional args go to roots", () => {
  const opts = parseArgs(["apps", "packages"]);
  assert.deepEqual(opts.roots, ["apps", "packages"]);
});

test("parseArgs: throws on invalid format", () => {
  assert.throws(() => parseArgs(["--format", "xml"]), /must be text or json/);
});

test("parseArgs: throws on unknown option", () => {
  assert.throws(() => parseArgs(["--unknown-flag"]), /Unknown option/);
});

// ??? findRepoRoot ?????????????????????????????????????????????????????????????

test("findRepoRoot: finds repo root from inside repo", () => {
  const found = findRepoRoot(path.join(repoRoot, "tools", "architecture"));
  assert.equal(found, repoRoot);
});

test("findRepoRoot: returns startDir when no schema found", () => {
  const found = findRepoRoot("/nonexistent/deeply/nested/path");
  assert.equal(found, "/nonexistent/deeply/nested/path");
});

// ??? isObject ????????????????????????????????????????????????????????????????

test("isObject: returns true for plain objects", () => {
  assert.equal(isObject({}), true);
  assert.equal(isObject({ a: 1 }), true);
});

test("isObject: returns false for non-objects", () => {
  assert.equal(isObject(null), false);
  assert.equal(isObject([]), false);
  assert.equal(isObject("string"), false);
  assert.equal(isObject(42), false);
  assert.equal(isObject(undefined), false);
});

// ??? REQUIRED_ARCHITECTURE_GROUPS ????????????????????????????????????????????

test("REQUIRED_ARCHITECTURE_GROUPS: includes all required fields", () => {
  const expected = [
    "schemaVersion",
    "component",
    "lifecycle",
    "governance",
    "runtime",
    "boundaries",
    "relations",
    "tags",
    "readme",
  ];
  for (const field of expected) {
    assert.ok(REQUIRED_ARCHITECTURE_GROUPS.includes(field), `missing: ${field}`);
  }
});

// ??? validateArchitectureGroups ???????????????????????????????????????????????

test("validateArchitectureGroups: no errors for complete valid architecture", () => {
  const errors = [];
  const arch = {
    schemaVersion: "1.0",
    component: {},
    lifecycle: {},
    governance: {},
    runtime: {},
    boundaries: {},
    relations: {},
    tags: {},
    readme: {},
  };
  validateArchitectureGroups(arch, errors);
  assert.equal(errors.length, 0);
});

test("validateArchitectureGroups: reports missing groups", () => {
  const errors = [];
  validateArchitectureGroups({ schemaVersion: "1.0" }, errors);
  assert.ok(errors.some((e) => e.includes("component")));
  assert.ok(errors.some((e) => e.includes("lifecycle")));
});

test("validateArchitectureGroups: reports wrong schemaVersion", () => {
  const errors = [];
  const arch = {
    schemaVersion: "2.0",
    component: {},
    lifecycle: {},
    governance: {},
    runtime: {},
    boundaries: {},
    relations: {},
    tags: {},
    readme: {},
  };
  validateArchitectureGroups(arch, errors);
  assert.ok(errors.some((e) => e.includes("schemaVersion must be 1.0")));
});

// ??? validateComponent ????????????????????????????????????????????????????????

test("validateComponent: valid component has no errors", () => {
  const errors = [];
  validateComponent(
    {
      type: "library",
      name: "foo",
      system: "platform",
      domain: "core",
      boundedContext: "domain-core",
      owner: "team-platform",
    },
    errors
  );
  assert.equal(errors.length, 0);
});

test("validateComponent: missing fields produce errors", () => {
  const errors = [];
  validateComponent({}, errors);
  assert.ok(errors.some((e) => e.includes("component.type is required")));
  assert.ok(errors.some((e) => e.includes("component.name is required")));
  assert.ok(errors.some((e) => e.includes("component.owner is required")));
});

test("validateComponent: invalid type produces error", () => {
  const errors = [];
  validateComponent(
    {
      type: "invalid-type",
      name: "foo",
      system: "s",
      domain: "d",
      boundedContext: "bc",
      owner: "team",
    },
    errors
  );
  assert.ok(errors.some((e) => e.includes("component.type must be one of")));
});

test("validateComponent: non-object produces error", () => {
  const errors = [];
  validateComponent(null, errors);
  assert.ok(errors.some((e) => e.includes("component must be an object")));
});

// ??? validateLifecycle ????????????????????????????????????????????????????????

test("validateLifecycle: valid active.tooling lifecycle has no errors", () => {
  const errors = [];
  validateLifecycle(
    {
      stage: "active",
      role: "tooling",
      class: "active.tooling",
      catalogLifecycle: "production",
      visibility: "internal",
      supportLevel: "standard",
      reviewCadence: "quarterly",
    },
    errors
  );
  assert.equal(errors.length, 0);
});

test("validateLifecycle: invalid stage produces error", () => {
  const errors = [];
  validateLifecycle(
    {
      stage: "unknown",
      role: "tooling",
      class: "unknown.tooling",
      catalogLifecycle: "production",
      visibility: "internal",
      supportLevel: "standard",
    },
    errors
  );
  assert.ok(errors.some((e) => e.includes("lifecycle.stage must be one of")));
});

test("validateLifecycle: class mismatch produces error", () => {
  const errors = [];
  validateLifecycle(
    {
      stage: "active",
      role: "tooling",
      class: "candidate.tooling", // wrong
      catalogLifecycle: "production",
      visibility: "internal",
      supportLevel: "standard",
    },
    errors
  );
  assert.ok(errors.some((e) => e.includes("lifecycle.class must equal active.tooling")));
});

test("validateLifecycle: experimental stage requires catalogLifecycle=experimental", () => {
  const errors = [];
  validateLifecycle(
    {
      stage: "experimental",
      role: "feature",
      class: "experimental.feature",
      catalogLifecycle: "production", // wrong
      visibility: "internal",
      supportLevel: "standard",
    },
    errors
  );
  assert.ok(errors.some((e) => e.includes("catalogLifecycle must equal experimental")));
});

test("validateLifecycle: deprecated stage requires deprecated visibility and support", () => {
  const errors = [];
  validateLifecycle(
    {
      stage: "deprecated",
      role: "feature",
      class: "deprecated.feature",
      catalogLifecycle: "deprecated",
      visibility: "internal", // wrong
      supportLevel: "standard", // wrong
    },
    errors
  );
  assert.ok(errors.some((e) => e.includes("visibility must be deprecated")));
  assert.ok(errors.some((e) => e.includes("supportLevel must be deprecated or unsupported")));
});

test("validateLifecycle: external stage requires external visibility", () => {
  const errors = [];
  validateLifecycle(
    {
      stage: "external",
      role: "adapter",
      class: "external.adapter",
      catalogLifecycle: "production",
      visibility: "internal", // wrong for external
      supportLevel: "standard",
    },
    errors
  );
  assert.ok(errors.some((e) => e.includes("visibility must be external")));
});

test("validateLifecycle: non-object produces error", () => {
  const errors = [];
  validateLifecycle(null, errors);
  assert.ok(errors.some((e) => e.includes("lifecycle must be an object")));
});

test("validateTagProjection: matching stage+role projection passes", () => {
  const errors = [];
  validateTagProjection(
    { stage: "deprecated", role: "platform" },
    { stage: "deprecated", role: "platform" },
    errors
  );
  assert.equal(errors.length, 0);
});

test("validateTagProjection: mismatched stage fails", () => {
  const errors = [];
  validateTagProjection(
    { stage: "deprecated", role: "platform" },
    { stage: "active", role: "platform" },
    errors
  );
  assert.ok(errors.some((e) => e.includes("tags.stage") && e.includes("lifecycle.stage")));
});

test("validateTagProjection: mismatched role fails", () => {
  const errors = [];
  validateTagProjection(
    { stage: "active", role: "platform" },
    { stage: "active", role: "feature" },
    errors
  );
  assert.ok(errors.some((e) => e.includes("tags.role") && e.includes("lifecycle.role")));
});

test("validateTagProjection: deprecated lifecycle with active tag projection fails", () => {
  const errors = [];
  validateTagProjection(
    { stage: "deprecated", role: "platform" },
    { stage: "active", role: "platform" },
    errors
  );
  assert.ok(errors.length > 0, "a deprecated package whose tags say active must fail");
});

test("validateTagProjection: deprecated passes only when BOTH projections are deprecated", () => {
  const ok = [];
  validateTagProjection(
    { stage: "deprecated", role: "platform" },
    { stage: "deprecated", role: "platform" },
    ok
  );
  assert.equal(ok.length, 0);
  const bad = [];
  validateTagProjection(
    { stage: "deprecated", role: "platform" },
    { stage: "stable", role: "platform" },
    bad
  );
  assert.ok(bad.length > 0);
});

// ??? validateGovernance ???????????????????????????????????????????????????????

test("validateGovernance: valid governance has no errors", () => {
  const errors = [];
  validateGovernance(
    {
      decisionRefs: ["ADR-0001"],
      semverPolicy: "internal-traceable",
      changeControl: "owner-review",
      promotionEligible: true,
    },
    errors
  );
  assert.equal(errors.length, 0);
});

test("validateGovernance: empty decisionRefs produces error", () => {
  const errors = [];
  validateGovernance(
    {
      decisionRefs: [],
      semverPolicy: "none",
      changeControl: "none",
      promotionEligible: false,
    },
    errors
  );
  assert.ok(errors.some((e) => e.includes("decisionRefs must be a non-empty array")));
});

test("validateGovernance: invalid ADR ref format", () => {
  const errors = [];
  validateGovernance(
    {
      decisionRefs: ["adr-001"], // wrong format
      semverPolicy: "none",
      changeControl: "none",
      promotionEligible: false,
    },
    errors
  );
  assert.ok(errors.some((e) => e.includes("invalid ADR reference")));
});

test("validateGovernance: invalid semverPolicy", () => {
  const errors = [];
  validateGovernance(
    {
      decisionRefs: ["ADR-0001"],
      semverPolicy: "invalid",
      changeControl: "none",
      promotionEligible: false,
    },
    errors
  );
  assert.ok(errors.some((e) => e.includes("semverPolicy must be one of")));
});

test("validateGovernance: non-boolean promotionEligible", () => {
  const errors = [];
  validateGovernance(
    {
      decisionRefs: ["ADR-0001"],
      semverPolicy: "none",
      changeControl: "none",
      promotionEligible: "yes",
    },
    errors
  );
  assert.ok(errors.some((e) => e.includes("promotionEligible must be boolean")));
});

// ??? validateLifecycleGovernanceConsistency ????????????????????????????????????

test("validateLifecycleGovernanceConsistency: deprecated stage requires deprecation-review", () => {
  const errors = [];
  validateLifecycleGovernanceConsistency(
    { stage: "deprecated" },
    { changeControl: "owner-review", semverPolicy: "internal-traceable", promotionEligible: false },
    errors
  );
  assert.ok(errors.some((e) => e.includes("changeControl must be deprecation-review")));
  assert.ok(errors.some((e) => e.includes("semverPolicy must be deprecated")));
});

test("validateLifecycleGovernanceConsistency: deprecated cannot be promotionEligible", () => {
  const errors = [];
  validateLifecycleGovernanceConsistency(
    { stage: "deprecated" },
    { changeControl: "deprecation-review", semverPolicy: "deprecated", promotionEligible: true },
    errors
  );
  assert.ok(errors.some((e) => e.includes("promotionEligible must be false")));
});

test("validateLifecycleGovernanceConsistency: external requires correct semverPolicy", () => {
  const errors = [];
  validateLifecycleGovernanceConsistency({ stage: "external" }, { semverPolicy: "none" }, errors);
  assert.ok(
    errors.some((e) => e.includes("semverPolicy must be semver-required or external-governed"))
  );
});

test("validateLifecycleGovernanceConsistency: no errors when both are non-objects", () => {
  const errors = [];
  validateLifecycleGovernanceConsistency(null, null, errors);
  assert.equal(errors.length, 0);
});

// ??? validateRuntime ?????????????????????????????????????????????????????????

test("validateRuntime: valid runtime has no errors", () => {
  const errors = [];
  validateRuntime(
    {
      production: true,
      testOnly: false,
      serviceName: "my-service",
      serviceNamespace: "platform",
      deploymentEnvironments: ["production"],
    },
    errors
  );
  assert.equal(errors.length, 0);
});

test("validateRuntime: production and testOnly both true is invalid", () => {
  const errors = [];
  validateRuntime(
    {
      production: true,
      testOnly: true,
      serviceName: "x",
      serviceNamespace: "y",
      deploymentEnvironments: [],
    },
    errors
  );
  assert.ok(errors.some((e) => e.includes("cannot both be true")));
});

test("validateRuntime: missing serviceName produces error", () => {
  const errors = [];
  validateRuntime(
    {
      production: false,
      testOnly: false,
      serviceNamespace: "y",
      deploymentEnvironments: [],
    },
    errors
  );
  assert.ok(errors.some((e) => e.includes("serviceName is required")));
});

test("validateRuntime: non-array deploymentEnvironments produces error", () => {
  const errors = [];
  validateRuntime(
    {
      production: false,
      testOnly: false,
      serviceName: "x",
      serviceNamespace: "y",
      deploymentEnvironments: "production",
    },
    errors
  );
  assert.ok(errors.some((e) => e.includes("deploymentEnvironments must be an array")));
});

// ??? validateBoundaries ???????????????????????????????????????????????????????

test("validateBoundaries: valid boundaries has no errors", () => {
  const errors = [];
  validateBoundaries(
    {
      publicExportsOnly: true,
      deepImportsAllowed: false,
      allowedConsumers: ["feature"],
      forbiddenConsumers: [],
    },
    errors
  );
  assert.equal(errors.length, 0);
});

test("validateBoundaries: publicExportsOnly=true and deepImportsAllowed=true is invalid", () => {
  const errors = [];
  validateBoundaries(
    {
      publicExportsOnly: true,
      deepImportsAllowed: true,
      allowedConsumers: [],
      forbiddenConsumers: [],
    },
    errors
  );
  assert.ok(errors.some((e) => e.includes("deepImportsAllowed must be false")));
});

test("validateBoundaries: non-array consumers produce errors", () => {
  const errors = [];
  validateBoundaries(
    {
      publicExportsOnly: false,
      deepImportsAllowed: false,
      allowedConsumers: "feature",
      forbiddenConsumers: null,
    },
    errors
  );
  assert.ok(errors.some((e) => e.includes("allowedConsumers must be an array")));
  assert.ok(errors.some((e) => e.includes("forbiddenConsumers must be an array")));
});

// ??? validateRelations ????????????????????????????????????????????????????????

test("validateRelations: valid relations has no errors", () => {
  const errors = [];
  validateRelations(
    {
      dependsOn: [],
      providesApis: [],
      consumesApis: [],
    },
    errors
  );
  assert.equal(errors.length, 0);
});

test("validateRelations: non-array fields produce errors", () => {
  const errors = [];
  validateRelations({ dependsOn: "foo", providesApis: null, consumesApis: 42 }, errors);
  assert.ok(errors.some((e) => e.includes("dependsOn must be an array")));
  assert.ok(errors.some((e) => e.includes("providesApis must be an array")));
  assert.ok(errors.some((e) => e.includes("consumesApis must be an array")));
});

// ??? validateTags ?????????????????????????????????????????????????????????????

test("validateTags: valid tags has no errors", () => {
  const errors = [];
  validateTags(
    {
      scope: "platform",
      type: "library",
      stage: "active",
      role: "platform",
      layer: "domain",
    },
    errors
  );
  assert.equal(errors.length, 0);
});

test("validateTags: missing required fields produce errors", () => {
  const errors = [];
  validateTags({}, errors);
  assert.ok(errors.some((e) => e.includes("tags.scope is required")));
  assert.ok(errors.some((e) => e.includes("tags.type is required")));
  assert.ok(errors.some((e) => e.includes("tags.stage is required")));
  assert.ok(errors.some((e) => e.includes("tags.role is required")));
  assert.ok(errors.some((e) => e.includes("tags.layer is required")));
});

// ??? validateReadme ???????????????????????????????????????????????????????????

test("validateReadme: valid readme has no errors", () => {
  const errors = [];
  validateReadme(
    {
      generated: true,
      summary: "A package summary",
      responsibilities: ["does things"],
      nonResponsibilities: [],
      usage: ["use it like this"],
      operationalNotes: [],
    },
    errors
  );
  assert.equal(errors.length, 0);
});

test("validateReadme: generated must be true", () => {
  const errors = [];
  validateReadme(
    {
      generated: false,
      summary: "summary",
      responsibilities: [],
      nonResponsibilities: [],
      usage: [],
      operationalNotes: [],
    },
    errors
  );
  assert.ok(errors.some((e) => e.includes("readme.generated must be true")));
});

test("validateReadme: missing summary produces error", () => {
  const errors = [];
  validateReadme(
    {
      generated: true,
      responsibilities: [],
      nonResponsibilities: [],
      usage: [],
      operationalNotes: [],
    },
    errors
  );
  assert.ok(errors.some((e) => e.includes("readme.summary is required")));
});

test("validateReadme: non-array fields produce errors", () => {
  const errors = [];
  validateReadme(
    {
      generated: true,
      summary: "ok",
      responsibilities: "one",
      nonResponsibilities: null,
      usage: 42,
      operationalNotes: {},
    },
    errors
  );
  assert.ok(errors.some((e) => e.includes("responsibilities must be an array")));
  assert.ok(errors.some((e) => e.includes("nonResponsibilities must be an array")));
  assert.ok(errors.some((e) => e.includes("usage must be an array")));
  assert.ok(errors.some((e) => e.includes("operationalNotes must be an array")));
});

// ??? applySchemaValidation ????????????????????????????????????????????????????

test("applySchemaValidation: does nothing when schemaValidator is null", () => {
  const errors = [];
  const warnings = [];
  applySchemaValidation({}, null, errors, warnings, false);
  assert.equal(errors.length, 0);
  assert.equal(warnings.length, 0);
});

test("applySchemaValidation: missingAjv with allowMissingAjv=true adds warning", () => {
  const errors = [];
  const warnings = [];
  applySchemaValidation({}, { missingAjv: true }, errors, warnings, true);
  assert.equal(errors.length, 0);
  assert.ok(warnings.some((w) => w.includes("Ajv")));
});

test("applySchemaValidation: missingAjv with allowMissingAjv=false adds error", () => {
  const errors = [];
  const warnings = [];
  applySchemaValidation({}, { missingAjv: true }, errors, warnings, false);
  assert.ok(errors.some((e) => e.includes("Ajv")));
  assert.equal(warnings.length, 0);
});

// ??? validatePackage (integration) ????????????????????????????????????????????

function makeValidPackageJson(overrides = {}) {
  return {
    name: "@platform/my-package",
    version: "1.0.0",
    description: "A test package",
    private: true,
    type: "module",
    exports: { ".": "./src/index.ts" },
    architecture: {
      schemaVersion: "1.0",
      component: {
        type: "library",
        name: "my-package",
        system: "platform",
        domain: "core",
        boundedContext: "domain-core",
        owner: "team-platform",
      },
      lifecycle: {
        stage: "active",
        role: "platform",
        class: "active.platform",
        catalogLifecycle: "production",
        visibility: "internal",
        supportLevel: "standard",
        reviewCadence: "quarterly",
      },
      governance: {
        decisionRefs: ["ADR-0001"],
        semverPolicy: "internal-traceable",
        changeControl: "owner-review",
        promotionEligible: true,
      },
      runtime: {
        production: true,
        testOnly: false,
        serviceName: "my-package",
        serviceNamespace: "platform",
        deploymentEnvironments: ["production"],
      },
      boundaries: {
        publicExportsOnly: true,
        deepImportsAllowed: false,
        allowedConsumers: ["feature"],
        forbiddenConsumers: [],
      },
      relations: { dependsOn: [], providesApis: [], consumesApis: [] },
      tags: {
        scope: "platform",
        type: "library",
        stage: "active",
        role: "platform",
        layer: "domain",
      },
      readme: {
        generated: true,
        summary: "Provides core services",
        responsibilities: ["does things"],
        nonResponsibilities: [],
        usage: ["import and use"],
        operationalNotes: [],
      },
    },
    ...overrides,
  };
}

test("validatePackage: valid package has no errors", () => {
  const pkg = makeValidPackageJson();
  const result = validatePackage(pkg, "/some/path/package.json", null, false);
  assert.equal(result.valid, true);
  assert.equal(result.errors.length, 0);
  assert.equal(result.packageName, "@platform/my-package");
});

test("validatePackage: missing required package fields", () => {
  const pkg = { name: "@platform/foo" }; // missing many fields
  const result = validatePackage(pkg, "/path/package.json", null, false);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("Missing required package field: version")));
  assert.ok(result.errors.some((e) => e.includes("Missing required package field: exports")));
});

test("validatePackage: missing architecture object", () => {
  const pkg = makeValidPackageJson({ architecture: null });
  const result = validatePackage(pkg, "/path/package.json", null, false);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("Missing or invalid architecture object")));
});

test("validatePackage: deprecated lifecycle with wrong governance", () => {
  const pkg = makeValidPackageJson({
    architecture: {
      ...makeValidPackageJson().architecture,
      lifecycle: {
        stage: "deprecated",
        role: "platform",
        class: "deprecated.platform",
        catalogLifecycle: "deprecated",
        visibility: "deprecated",
        supportLevel: "deprecated",
      },
      governance: {
        decisionRefs: ["ADR-0001"],
        semverPolicy: "internal-traceable", // wrong for deprecated
        changeControl: "owner-review", // wrong for deprecated
        promotionEligible: false,
      },
    },
  });
  const result = validatePackage(pkg, "/path/package.json", null, false);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("changeControl must be deprecation-review")));
  assert.ok(result.errors.some((e) => e.includes("semverPolicy must be deprecated")));
});

// ??? listPackageJsonFiles ?????????????????????????????????????????????????????

test("listPackageJsonFiles: finds packages in real repo", () => {
  const files = listPackageJsonFiles(["apps", "packages", "tools/architecture"], repoRoot);
  assert.ok(Array.isArray(files));
  assert.ok(files.length > 0);
  for (const f of files) {
    assert.ok(f.endsWith("package.json"));
  }
});

test("listPackageJsonFiles: returns empty for nonexistent root", () => {
  const files = listPackageJsonFiles(["nonexistent-dir"], repoRoot);
  assert.deepEqual(files, []);
});

test("listPackageJsonFiles: scans fixture directories when fixtures in path", () => {
  const fixturesPath = path.join(__dirname, "fixtures", "valid", "schema-valid");
  // When the searchRoot includes 'fixtures', fixture scan is enabled
  const relativePath = path.relative(repoRoot, fixturesPath);
  const files = listPackageJsonFiles([relativePath], repoRoot);
  assert.ok(files.length > 0);
  assert.ok(files.some((f) => f.includes("schema-valid")));
});
