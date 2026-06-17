// ADR-ACT-0285 (closure) — scenario-manifest model + validator tests.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, cpSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadModel,
  expand,
  ladderFrom,
  personaMatrixDenialRequired,
  requiredLogScenarioIds,
  requiredTraceScenarios,
  allScenarioIds,
} from "./scenario-manifest.mjs";
import { validateScenarioManifest, analyzeSpec } from "./validate-scenario-manifest/src/index.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

// ── Pure model ────────────────────────────────────────────────────────────
test("ladderFrom returns the stage and everything above it", () => {
  assert.deepEqual(ladderFrom("test"), ["test", "staging", "prod"]);
  assert.deepEqual(ladderFrom("prod"), ["prod"]);
  assert.deepEqual(ladderFrom("dev"), ["dev", "test", "staging", "prod"]);
});

test("personaMatrixDenialRequired mirrors the real run/skip logic", () => {
  const unauth = {
    personaId: "unauthenticated-visitor",
    authMode: "unauthenticated",
    provisionRef: null,
    forbiddenApiAccess: ["GET /api/admin/tenants"],
  };
  assert.equal(personaMatrixDenialRequired(unauth, "test"), true);

  const sysadmin = {
    personaId: "scaffold-system-admin",
    authMode: "real",
    provisionRef: "keycloak:sysadmin@x",
    forbiddenApiAccess: [],
  };
  assert.equal(
    personaMatrixDenialRequired(sysadmin, "staging"),
    false,
    "no forbidden API → not required"
  );

  const expired = {
    personaId: "scaffold-expired-session",
    authMode: "real",
    provisionRef: "scaffold-tenant-admin with expired cookie",
    forbiddenApiAccess: ["GET /api/session"],
  };
  assert.equal(
    personaMatrixDenialRequired(expired, "staging"),
    false,
    "no distinct keycloak account → skipped → not required"
  );

  const notProvisioned = {
    personaId: "x",
    authMode: "real",
    provisionRef: "keycloak:x@y NOT YET PROVISIONED",
    forbiddenApiAccess: ["GET /a"],
  };
  assert.equal(personaMatrixDenialRequired(notProvisioned, "prod"), false);

  const crossTenant = {
    personaId: "scaffold-cross-tenant",
    authMode: "real",
    provisionRef: "reuses tenant-admin",
    forbiddenApiAccess: ["tenant-b:GET /api/organisation/profile"],
  };
  assert.equal(
    personaMatrixDenialRequired(crossTenant, "prod"),
    true,
    "cross-tenant required at prod (TLS reachable)"
  );
  assert.equal(
    personaMatrixDenialRequired(crossTenant, "staging"),
    false,
    "cross-tenant tenant-B TLS not reachable on staging → not required"
  );

  const skipParam = {
    personaId: "p",
    authMode: "real",
    provisionRef: "keycloak:p@y",
    forbiddenApiAccess: ["POST /api/admin/tenants/:tenantId/x"],
  };
  assert.equal(
    personaMatrixDenialRequired(skipParam, "prod"),
    false,
    "unresolved path param is not a deterministic denial"
  );
});

test("dynamic persona expansion is deterministic and id-stable (not title-derived)", () => {
  const model = loadModel(REPO);
  const expanded = expand(model);
  // every dynamic id follows the template, never a sanitised title
  const personaIds = expanded.filter((s) => s.dynamic).map((s) => s.scenarioId);
  assert.ok(personaIds.length > 0);
  for (const id of personaIds) assert.match(id, /^persona-matrix:[a-z0-9-]+$/);
  // re-expansion is identical (stable)
  const again = expand(loadModel(REPO)).map((s) => s.scenarioId);
  assert.deepEqual(allScenarioIds(expanded), again);
  // global uniqueness
  assert.equal(new Set(again).size, again.length, "scenario ids are globally unique");
});

test("required log/trace sets per stage are honest", () => {
  const expanded = expand(loadModel(REPO));
  const testReq = requiredLogScenarioIds(expanded, "test");
  assert.ok(testReq.includes("pipeline-health-probe"));
  assert.ok(testReq.includes("persona-authz"));
  assert.ok(testReq.includes("persona-matrix:unauthenticated-visitor"));
  // dev runs no observability-correlation group → no required scenarios
  assert.deepEqual(requiredLogScenarioIds(expanded, "dev"), []);
  // system-admin / support / expired never REQUIRED (legitimately may produce no denial)
  const stagingReq = requiredLogScenarioIds(expanded, "staging");
  assert.ok(!stagingReq.includes("persona-matrix:scaffold-system-admin"));
  assert.ok(!stagingReq.includes("persona-matrix:scaffold-expired-session"));
  // BOTH the probe (platform-api) and the browser-bff-trace (react-enterprise-app +
  // platform-api) are required Tempo trace scenarios at every reporting stage.
  for (const st of ["test", "staging", "prod"])
    assert.deepEqual(
      requiredTraceScenarios(expanded, st).map((s) => s.scenarioId),
      ["pipeline-health-probe", "browser-bff-trace"]
    );
});

// ── Validator (happy path on the real tree) ─────────────────────────────────
test("validator PASSES on the real repository tree", () => {
  const r = validateScenarioManifest(REPO);
  assert.deepEqual(r.failures, [], `unexpected failures: ${r.failures.join("\n")}`);
});

// ── Validator (synthetic failure modes) ─────────────────────────────────────
function makeRoot(manifest, files = {}) {
  const root = mkdtempSync(join(tmpdir(), "scn-"));
  mkdirSync(join(root, "e2e"), { recursive: true });
  // real registries give the validator real suite/persona data
  cpSync(join(REPO, "e2e/suite-registry.json"), join(root, "e2e/suite-registry.json"));
  cpSync(join(REPO, "e2e/persona-registry.json"), join(root, "e2e/persona-registry.json"));
  writeFileSync(join(root, "e2e/scenario-manifest.json"), JSON.stringify(manifest, null, 2));
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), content);
  }
  return root;
}
const CORR_IMPORT = `import { test } from "../support/correlation.ts";\ntest.use({ scenarioId: "x" });\n`;
const baseManifest = () => ({
  schemaVersion: 1,
  stageVocabulary: ["dev", "test", "staging", "prod"],
  authModeVocabulary: ["fixture", "real", "unauthenticated", "mixed"],
  correlationVocabulary: ["required", "best-effort", "none", "conditional"],
  knownServices: ["platform-api", "react-enterprise-app"],
  scenarios: [],
  dynamicScenarios: [],
  exemptions: [],
});

test("orphan test (no scenario/exemption) FAILS", () => {
  const m = baseManifest();
  const root = makeRoot(m, { "e2e/feature/orphan.spec.ts": CORR_IMPORT });
  try {
    const r = validateScenarioManifest(root);
    assert.ok(
      r.failures.some((f) => /orphan\.spec\.ts.*no scenario/.test(f)),
      r.failures.join("\n")
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("duplicate scenario id FAILS", () => {
  const m = baseManifest();
  const sc = {
    suiteId: "discovery-clickability",
    file: "e2e/a.spec.ts",
    source: "playwright",
    stages: ["test"],
    authMode: "mixed",
    expectedLogs: ["x"],
    expectedTraces: null,
    correlation: { logs: "none", traces: "none" },
    owner: "t",
  };
  m.scenarios = [
    { ...sc, scenarioId: "dup" },
    { ...sc, scenarioId: "dup", file: "e2e/b.spec.ts" },
  ];
  const root = makeRoot(m, { "e2e/a.spec.ts": CORR_IMPORT, "e2e/b.spec.ts": CORR_IMPORT });
  try {
    const r = validateScenarioManifest(root);
    assert.ok(
      r.failures.some((f) => /duplicate scenario id.*dup/.test(f)),
      r.failures.join("\n")
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("manifest entry referencing a missing file FAILS", () => {
  const m = baseManifest();
  m.scenarios = [
    {
      scenarioId: "ghost",
      suiteId: "discovery-clickability",
      file: "e2e/does-not-exist.spec.ts",
      source: "playwright",
      stages: ["test"],
      authMode: "mixed",
      expectedLogs: [],
      expectedTraces: null,
      correlation: { logs: "none", traces: "none" },
      owner: "t",
    },
  ];
  const root = makeRoot(m);
  try {
    const r = validateScenarioManifest(root);
    assert.ok(
      r.failures.some((f) => /missing file/.test(f)),
      r.failures.join("\n")
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("correlated spec relying on a title (no explicit scenarioId) FAILS", () => {
  const m = baseManifest();
  m.scenarios = [
    {
      scenarioId: "titled",
      suiteId: "discovery-clickability",
      file: "e2e/titled.spec.ts",
      source: "playwright",
      stages: ["test"],
      authMode: "mixed",
      expectedLogs: [],
      expectedTraces: null,
      correlation: { logs: "none", traces: "none" },
      owner: "t",
    },
  ];
  // imports correlation but never declares an explicit scenarioId
  const root = makeRoot(m, {
    "e2e/titled.spec.ts": `import { test } from "../support/correlation.ts";\ntest("t", async () => {});\n`,
  });
  try {
    const r = validateScenarioManifest(root);
    assert.ok(
      r.failures.some((f) =>
        /unmapped test|no scenario\(\) annotation|not declared in source/.test(f)
      ),
      r.failures.join("\n")
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("correlated spec that is ONLY exempted FAILS", () => {
  const m = baseManifest();
  m.exemptions = [
    { file: "e2e/sneaky.spec.ts", reason: "this is a correlated spec but only exempted here" },
  ];
  const root = makeRoot(m, { "e2e/sneaky.spec.ts": CORR_IMPORT });
  try {
    const r = validateScenarioManifest(root);
    assert.ok(
      r.failures.some((f) => /imports the correlation fixture but is only EXEMPTED/.test(f)),
      r.failures.join("\n")
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("scenario stage below the suite stageMin FAILS", () => {
  const m = baseManifest();
  // discovery-clickability has stageMin=test; declaring dev is incompatible
  m.scenarios = [
    {
      scenarioId: "early",
      suiteId: "discovery-clickability",
      file: "e2e/early.spec.ts",
      source: "playwright",
      stages: ["dev"],
      authMode: "mixed",
      expectedLogs: [],
      expectedTraces: null,
      correlation: { logs: "none", traces: "none" },
      owner: "t",
    },
  ];
  const root = makeRoot(m, { "e2e/early.spec.ts": CORR_IMPORT });
  try {
    const r = validateScenarioManifest(root);
    assert.ok(
      r.failures.some((f) => /below suite.*stageMin/.test(f)),
      r.failures.join("\n")
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ── per-test AST analysis (Option A) ────────────────────────────────────────
test("analyzeSpec extracts file-level test.use scenarioId + per-test scenario kinds", () => {
  const a = analyzeSpec(
    `import { test } from "../support/correlation.ts";\ntest.use({ scenarioId: "f" });\ntest("a", async () => {});\ntest("b", async () => {});\n`
  );
  assert.equal(a.fileScenarioId, "f");
  assert.equal(a.tests.length, 2);
  assert.ok(a.tests.every((t) => t.scenario.kind === "none"));

  const b = analyzeSpec(
    `import { test, scenario } from "../support/correlation.ts";\ntest("x", { annotation: scenario("lit-id") }, async () => {});\ntest("y", { annotation: scenario(\`pm:\${p.id}\`) }, async () => {});\ntest.describe("grp", () => {});\n`
  );
  assert.equal(b.fileScenarioId, null);
  assert.equal(b.tests.length, 2, "test.describe is NOT an executable test");
  assert.deepEqual(b.tests[0].scenario, { kind: "literal", value: "lit-id" });
  assert.equal(b.tests[1].scenario.kind, "template");
  assert.equal(b.tests[1].scenario.prefix, "pm:");
});

function astRoot(scenarios, dynamicScenarios, files) {
  const m = baseManifest();
  m.scenarios = scenarios;
  m.dynamicScenarios = dynamicScenarios ?? [];
  return makeRoot(m, files);
}
const staticScn = (id, file) => ({
  scenarioId: id,
  suiteId: "discovery-clickability",
  file,
  source: "playwright",
  stages: ["test"],
  authMode: "mixed",
  expectedLogs: [],
  expectedTraces: null,
  correlation: { logs: "none", traces: "none" },
  owner: "t",
});

test("per-test: an executable test with NO scenario mapping FAILS (case B)", () => {
  const root = astRoot([staticScn("s1", "e2e/x.spec.ts")], [], {
    "e2e/x.spec.ts": `import { test, scenario } from "../support/correlation.ts";\ntest("a", { annotation: scenario("s1") }, async () => {});\ntest("b", async () => {});\n`,
  });
  try {
    const r = validateScenarioManifest(root);
    assert.ok(
      r.failures.some((f) => /test "b".*unmapped test/.test(f)),
      r.failures.join("\n")
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("per-test: a source scenario id that is not in the manifest FAILS (source drift)", () => {
  const root = astRoot([staticScn("s1", "e2e/x.spec.ts")], [], {
    "e2e/x.spec.ts": `import { test, scenario } from "../support/correlation.ts";\ntest("a", { annotation: scenario("DIFFERENT") }, async () => {});\n`,
  });
  try {
    const r = validateScenarioManifest(root);
    assert.ok(
      r.failures.some((f) => /annotates scenarioId 'DIFFERENT'/.test(f)),
      r.failures.join("\n")
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("per-test: a manifest id not present in source FAILS (manifest drift, reverse)", () => {
  // file pins test.use 's1'; manifest declares 's2' for the file → both directions fail.
  const root = astRoot([staticScn("s2", "e2e/x.spec.ts")], [], {
    "e2e/x.spec.ts": `import { test } from "../support/correlation.ts";\ntest.use({ scenarioId: "s1" });\ntest("a", async () => {});\n`,
  });
  try {
    const r = validateScenarioManifest(root);
    assert.ok(
      r.failures.some((f) => /manifest scenario 's2'.*not declared in source/.test(f)),
      r.failures.join("\n")
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("per-test: dynamic persona template prefix must match the idTemplate", () => {
  const dyn = {
    baseScenarioId: "pm",
    suiteId: "discovery-persona-matrix",
    file: "e2e/m.spec.ts",
    source: "playwright",
    authMode: "mixed",
    expectedLogs: [],
    expectedTraces: null,
    dynamicSource: {
      registry: "e2e/persona-registry.json",
      collection: "personas",
      idField: "personaId",
      idTemplate: "pm:{personaId}",
      stageField: "stageAllowed",
      selector: { excludeIdPrefixes: ["a11y-"], excludeAuthModes: ["mixed"] },
    },
    correlation: { logs: "conditional", logsRequiredRule: "persona-matrix-denial", traces: "none" },
    owner: "t",
  };
  // matching prefix → passes the per-test mapping check
  const ok = astRoot([], [dyn], {
    "e2e/m.spec.ts": `import { test, scenario } from "../support/correlation.ts";\ntest("p", { annotation: scenario(\`pm:\${x.id}\`) }, async () => {});\n`,
  });
  try {
    assert.ok(!validateScenarioManifest(ok).failures.some((f) => /m\.spec\.ts/.test(f)));
  } finally {
    rmSync(ok, { recursive: true, force: true });
  }
  // wrong prefix → fails
  const bad = astRoot(
    [],
    [{ ...dyn, dynamicSource: { ...dyn.dynamicSource, idTemplate: "other:{personaId}" } }],
    {
      "e2e/m.spec.ts": `import { test, scenario } from "../support/correlation.ts";\ntest("p", { annotation: scenario(\`pm:\${x.id}\`) }, async () => {});\n`,
    }
  );
  try {
    assert.ok(validateScenarioManifest(bad).failures.some((f) => /template prefix 'pm:'/.test(f)));
  } finally {
    rmSync(bad, { recursive: true, force: true });
  }
});

test("traces required but no expectedTraces FAILS", () => {
  const m = baseManifest();
  m.scenarios = [
    {
      scenarioId: "notrace",
      suiteId: null,
      file: "tools/e2e/scenario-manifest.mjs",
      source: "harness",
      stages: ["test"],
      authMode: "unauthenticated",
      expectedLogs: ["x"],
      expectedTraces: null,
      correlation: { logs: "required", traces: "required" },
      owner: "t",
    },
  ];
  const root = makeRoot(m);
  try {
    const r = validateScenarioManifest(root);
    assert.ok(
      r.failures.some((f) => /traces=required but no expectedTraces/.test(f)),
      r.failures.join("\n")
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
