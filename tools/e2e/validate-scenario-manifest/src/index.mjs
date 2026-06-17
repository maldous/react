#!/usr/bin/env node
// ADR-0075 / ADR-ACT-0285 (closure) — scenario-manifest validator.
//
// Proves e2e/scenario-manifest.json is honest and complete:
//   - every executable E2E test on disk maps to EXACTLY ONE of: a scenario, a dynamic
//     expansion, or an explicit justified exemption (no orphan test, no double-claim)
//   - every manifest entry maps to an existing test file / harness emitter, and a real
//     suite-registry suite (when suiteId is set)
//   - scenario ids are globally unique + stable (static + every dynamic expansion)
//   - each scenario's stage policy is compatible with its suite (stages within
//     ladderFrom(suite.stageMin); every stage in the vocabulary)
//   - the expected-observability fields are valid (expectedTraces.services ⊆ knownServices;
//     correlation.logs/traces in the vocabulary; a conditional logs rule is a known rule)
//   - NO scenario relies on a sanitised test title: every correlated spec declares an
//     explicit scenarioId (test.use({scenarioId}) or the scenario() annotation)
// FAILS (exit 1) on any violation so removing/renaming a required scenario, or adding a
// test with no declaration, breaks `make all`. Writes honest evidence to
// docs/evidence/e2e/<stage>-scenario-manifest-latest.{json,md}. Pure Node.

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from "node:fs";
import { resolve, join, relative } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import {
  loadModel,
  expand,
  allScenarioIds,
  ladderFrom,
  REQUIRED_RULES,
} from "../../scenario-manifest.mjs";

const TEST_NONEXEC = new Set([
  "describe",
  "use",
  "beforeAll",
  "afterAll",
  "beforeEach",
  "afterEach",
  "step",
  "slow",
  "setTimeout",
]);

/**
 * Parse a Playwright spec with the TypeScript AST and enumerate its EXECUTABLE test()
 * declarations + the scenario id each one resolves to. Returns:
 *   { fileScenarioId: string|null,    // from a file-level test.use({ scenarioId: "X" })
 *     tests: [{ name, scenario: { kind: 'none'|'literal'|'template', value?, prefix? } }],
 *     parseError: string|null }
 * Executable = `test(...)`, `test.only/skip/fixme(...)` — NOT test.describe/use/hooks.
 */
export function analyzeSpec(src, fileName = "spec.ts") {
  const out = { fileScenarioId: null, tests: [], parseError: null };
  let sf;
  try {
    sf = ts.createSourceFile(fileName, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  } catch (e) {
    out.parseError = String(e?.message ?? e);
    return out;
  }

  const calleeName = (expr) => {
    if (ts.isIdentifier(expr)) return { base: expr.text, member: null };
    if (ts.isPropertyAccessExpression(expr) && ts.isIdentifier(expr.expression))
      return { base: expr.expression.text, member: expr.name.text };
    // test.only.skip etc — walk to the leftmost identifier
    if (ts.isPropertyAccessExpression(expr)) {
      let e = expr.expression;
      while (ts.isPropertyAccessExpression(e)) e = e.expression;
      if (ts.isIdentifier(e)) return { base: e.text, member: expr.name.text };
    }
    return { base: null, member: null };
  };

  // scenario(...) call → {kind, value|prefix}; an inline {type:"scenarioId", description} works too.
  const scenarioFromExpr = (expr) => {
    if (!expr) return { kind: "none" };
    if (
      ts.isCallExpression(expr) &&
      ts.isIdentifier(expr.expression) &&
      expr.expression.text === "scenario"
    ) {
      const arg = expr.arguments[0];
      if (arg && ts.isStringLiteral(arg)) return { kind: "literal", value: arg.text };
      if (arg && ts.isNoSubstitutionTemplateLiteral(arg))
        return { kind: "literal", value: arg.text };
      if (arg && ts.isTemplateExpression(arg)) return { kind: "template", prefix: arg.head.text };
      return { kind: "dynamic-unknown" };
    }
    return { kind: "none" };
  };

  // annotation from a test details object literal (2nd arg): { annotation: scenario(...) | {...} }
  const annotationScenario = (objLiteral) => {
    if (!objLiteral || !ts.isObjectLiteralExpression(objLiteral)) return { kind: "none" };
    for (const p of objLiteral.properties) {
      if (!ts.isPropertyAssignment(p)) continue;
      const key =
        p.name && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) ? p.name.text : null;
      if (key !== "annotation") continue;
      const v = p.initializer;
      if (ts.isCallExpression(v)) return scenarioFromExpr(v);
      // inline object { type: "scenarioId", description: "X" }
      if (ts.isObjectLiteralExpression(v)) {
        let isScenario = false;
        let desc = null;
        for (const ap of v.properties) {
          if (!ts.isPropertyAssignment(ap) || !ts.isIdentifier(ap.name)) continue;
          if (
            ap.name.text === "type" &&
            ts.isStringLiteral(ap.initializer) &&
            ap.initializer.text === "scenarioId"
          )
            isScenario = true;
          if (ap.name.text === "description" && ts.isStringLiteral(ap.initializer))
            desc = ap.initializer.text;
        }
        if (isScenario && desc) return { kind: "literal", value: desc };
      }
    }
    return { kind: "none" };
  };

  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      const { base, member } = calleeName(node.expression);
      if (base === "test") {
        if (member === "use") {
          const obj = node.arguments[0];
          if (obj && ts.isObjectLiteralExpression(obj)) {
            for (const p of obj.properties) {
              if (
                ts.isPropertyAssignment(p) &&
                p.name &&
                ((ts.isIdentifier(p.name) && p.name.text === "scenarioId") ||
                  (ts.isStringLiteral(p.name) && p.name.text === "scenarioId")) &&
                ts.isStringLiteral(p.initializer)
              )
                out.fileScenarioId = p.initializer.text;
            }
          }
        } else if (!member || !TEST_NONEXEC.has(member)) {
          // executable test(...) — title is arg0; details (with annotation) may be arg1.
          const title =
            node.arguments[0] && ts.isStringLiteral(node.arguments[0])
              ? node.arguments[0].text
              : "(dynamic title)";
          let scenario = { kind: "none" };
          for (let i = 1; i < node.arguments.length; i++) {
            const a = node.arguments[i];
            if (ts.isObjectLiteralExpression(a)) {
              const s = annotationScenario(a);
              if (s.kind !== "none") scenario = s;
            }
          }
          out.tests.push({ name: title, scenario });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

function listTestFiles(root) {
  const out = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(test|spec)\.ts$/.test(e.name)) out.push(relative(root, p));
    }
  };
  walk(join(root, "e2e"));
  return out.sort();
}

const ID_RE = /^[a-z0-9][a-z0-9:_-]*$/;

export function validateScenarioManifest(root = ".") {
  const failures = [];
  const reported = [];
  const model = loadModel(root);
  const { manifest, suiteRegistry } = model;
  const suiteIds = new Set((suiteRegistry.suites ?? []).map((s) => s.id));
  const knownServices = new Set(manifest.knownServices ?? []);
  const stageVocab = new Set(manifest.stageVocabulary ?? []);
  const corrVocab = new Set(manifest.correlationVocabulary ?? []);

  const staticScenarios = manifest.scenarios ?? [];
  const dynamicScenarios = manifest.dynamicScenarios ?? [];
  const exemptions = manifest.exemptions ?? [];

  // --- file → claim mapping (exactly one) ---
  const claims = new Map(); // file -> [kinds]
  const claim = (file, kind) => {
    if (!claims.has(file)) claims.set(file, []);
    claims.get(file).push(kind);
  };
  for (const s of staticScenarios)
    if (s.source !== "harness") claim(s.file, `scenario:${s.scenarioId}`);
  for (const d of dynamicScenarios) claim(d.file, `dynamic:${d.baseScenarioId}`);
  for (const e of exemptions) claim(e.file, "exemption");

  const onDisk = listTestFiles(root);
  const correlated = new Set(
    onDisk.filter((f) => {
      try {
        return /support\/correlation/.test(readFileSync(join(root, f), "utf8"));
      } catch {
        return false;
      }
    })
  );

  // every test on disk maps to exactly one claim
  for (const f of onDisk) {
    const kinds = claims.get(f) ?? [];
    if (kinds.length === 0)
      failures.push(`test file '${f}' has no scenario, dynamic expansion, or exemption`);
    else if (kinds.length > 1)
      failures.push(`test file '${f}' is claimed more than once: ${kinds.join(", ")}`);
  }
  // every manifest/exemption file exists; harness emitters too
  for (const s of staticScenarios)
    if (!existsSync(join(root, s.file)))
      failures.push(`scenario '${s.scenarioId}' references missing file: ${s.file}`);
  for (const d of dynamicScenarios)
    if (!existsSync(join(root, d.file)))
      failures.push(`dynamic '${d.baseScenarioId}' references missing file: ${d.file}`);
  const exemptionCategories = new Set(manifest.exemptionCategoryVocabulary ?? []);
  for (const e of exemptions) {
    if (!existsSync(join(root, e.file)))
      failures.push(`exemption references missing file: ${e.file}`);
    if (!e.reason || e.reason.length < 20)
      failures.push(`exemption for '${e.file}' lacks a substantive reason`);
    // Honest distinction (ADR-ACT-0285 closure): every exemption is categorised so an
    // exemption is never used merely because migration is inconvenient.
    if (!exemptionCategories.has(e.category))
      failures.push(
        `exemption for '${e.file}' has missing/unknown category '${e.category}' (expected one of ${[...exemptionCategories].join(", ")})`
      );
    if (correlated.has(e.file))
      failures.push(
        `file '${e.file}' imports the correlation fixture but is only EXEMPTED — a correlated spec must declare a scenario`
      );
  }

  // Per-TEST AST validation (Option A): every executable test() in a correlated spec maps
  // to EXACTLY ONE manifest scenario, and the literal/template ids in source MATCH the
  // manifest (so adding an un-mapped test, or drifting a source id vs the manifest, fails).
  const staticByFile = new Map();
  for (const s of staticScenarios) {
    if (!staticByFile.has(s.file)) staticByFile.set(s.file, []);
    staticByFile.get(s.file).push(s);
  }
  const dynamicByFile = new Map();
  for (const d of dynamicScenarios) {
    if (!dynamicByFile.has(d.file)) dynamicByFile.set(d.file, []);
    dynamicByFile.get(d.file).push(d);
  }
  // literal prefix of a dynamic idTemplate, e.g. "persona-matrix:{personaId}" → "persona-matrix:"
  const tmplPrefix = (d) => {
    const t = d.dynamicSource?.idTemplate ?? `${d.baseScenarioId}:{}`;
    const i = t.indexOf("{");
    return i >= 0 ? t.slice(0, i) : t;
  };

  for (const f of correlated) {
    const kinds = claims.get(f) ?? [];
    if (!kinds.some((k) => k.startsWith("scenario:") || k.startsWith("dynamic:"))) {
      failures.push(`correlated spec '${f}' has no scenario/dynamic manifest entry`);
      continue;
    }
    const analysis = analyzeSpec(readFileSync(join(root, f), "utf8"), f);
    if (analysis.parseError) {
      failures.push(`correlated spec '${f}' failed to parse: ${analysis.parseError}`);
      continue;
    }
    const fileStatic = staticByFile.get(f) ?? [];
    const fileDynamic = dynamicByFile.get(f) ?? [];

    if (analysis.fileScenarioId) {
      // Case A — file-level test.use({ scenarioId }): the whole file is ONE logical scenario;
      // every test() is a component of it. The literal MUST match exactly one manifest scenario.
      const match = fileStatic.find((s) => s.scenarioId === analysis.fileScenarioId);
      if (!match)
        failures.push(
          `correlated spec '${f}' declares test.use scenarioId '${analysis.fileScenarioId}' but no manifest scenario with that id maps to this file`
        );
      for (const t of analysis.tests)
        if (t.scenario.kind !== "none")
          failures.push(
            `correlated spec '${f}' test "${t.name}" carries a per-test scenario() annotation but the file already pins scenarioId '${analysis.fileScenarioId}' (ambiguous mapping)`
          );
    } else {
      // Case B — per-test annotations: EVERY executable test must declare scenario(); a literal
      // must match a manifest static scenario for this file; a template prefix must match a
      // dynamic idTemplate prefix for this file.
      if (analysis.tests.length === 0)
        failures.push(
          `correlated spec '${f}' has no executable test() and no file-level scenarioId`
        );
      for (const t of analysis.tests) {
        if (t.scenario.kind === "none") {
          failures.push(
            `correlated spec '${f}' test "${t.name}" has no scenario() annotation and the file has no test.use scenarioId (unmapped test)`
          );
        } else if (t.scenario.kind === "literal") {
          if (!fileStatic.some((s) => s.scenarioId === t.scenario.value))
            failures.push(
              `correlated spec '${f}' test "${t.name}" annotates scenarioId '${t.scenario.value}' but no manifest scenario with that id maps to this file`
            );
        } else if (t.scenario.kind === "template") {
          if (!fileDynamic.some((d) => tmplPrefix(d) === t.scenario.prefix))
            failures.push(
              `correlated spec '${f}' test "${t.name}" uses scenario template prefix '${t.scenario.prefix}' but no dynamic idTemplate with that prefix maps to this file`
            );
        } else {
          failures.push(
            `correlated spec '${f}' test "${t.name}" has an unrecognised scenario() argument (not a literal or persona template)`
          );
        }
      }
    }
  }
  // Reverse direction: every manifest static scenario whose file uses a file-level test.use
  // must have its id present in source (changing a manifest id without source → fail).
  for (const s of staticScenarios) {
    if (s.source === "harness") continue;
    if (!existsSync(join(root, s.file))) continue;
    const a = analyzeSpec(readFileSync(join(root, s.file), "utf8"), s.file);
    if (a.parseError) continue; // already reported above
    const inSource =
      a.fileScenarioId === s.scenarioId ||
      a.tests.some((t) => t.scenario.kind === "literal" && t.scenario.value === s.scenarioId);
    if (!inSource)
      failures.push(
        `manifest scenario '${s.scenarioId}' (file ${s.file}) is not declared in source (no matching test.use scenarioId or scenario() literal) — manifest/source drift`
      );
  }

  // --- suiteId integrity + stage compatibility ---
  const checkStages = (label, stages, suiteId) => {
    for (const st of stages)
      if (!stageVocab.has(st)) failures.push(`${label}: stage '${st}' not in stageVocabulary`);
    if (suiteId) {
      if (!suiteIds.has(suiteId)) {
        failures.push(`${label}: suiteId '${suiteId}' not in suite-registry`);
        return;
      }
      const suite = suiteRegistry.suites.find((s) => s.id === suiteId);
      const allowed = new Set(ladderFrom(suite.stageMin));
      for (const st of stages)
        if (!allowed.has(st))
          failures.push(
            `${label}: stage '${st}' is below suite '${suiteId}' stageMin '${suite.stageMin}'`
          );
    }
  };
  for (const s of staticScenarios)
    checkStages(`scenario '${s.scenarioId}'`, s.stages ?? [], s.suiteId);

  // --- observability field validity ---
  const checkObs = (label, sc) => {
    for (const key of ["logs", "traces"]) {
      const v = sc.correlation?.[key];
      if (v !== undefined && !corrVocab.has(v))
        failures.push(`${label}: correlation.${key}='${v}' not in correlationVocabulary`);
    }
    if (sc.correlation?.logs === "conditional") {
      const rule = sc.correlation.logsRequiredRule;
      if (!rule || !REQUIRED_RULES[rule])
        failures.push(
          `${label}: correlation.logs=conditional but logsRequiredRule '${rule}' is unknown`
        );
    }
    if (sc.expectedTraces) {
      for (const svc of sc.expectedTraces.services ?? [])
        if (!knownServices.has(svc))
          failures.push(`${label}: expectedTraces.service '${svc}' not in knownServices`);
      if (sc.correlation?.traces === "required" && !(sc.expectedTraces.services ?? []).length)
        failures.push(`${label}: traces required but expectedTraces.services is empty`);
    }
    if (sc.correlation?.traces === "required" && !sc.expectedTraces)
      failures.push(`${label}: correlation.traces=required but no expectedTraces declared`);
    for (const ev of sc.expectedLogs ?? [])
      if (typeof ev !== "string" || !ev.length)
        failures.push(`${label}: expectedLogs has an empty event name`);
  };
  for (const s of staticScenarios) checkObs(`scenario '${s.scenarioId}'`, s);
  for (const d of dynamicScenarios) checkObs(`dynamic '${d.baseScenarioId}'`, d);

  // --- global id uniqueness + format (static + all expansions) ---
  const expanded = expand(model);
  const ids = allScenarioIds(expanded);
  const seen = new Set();
  for (const id of ids) {
    if (!ID_RE.test(id)) failures.push(`scenario id '${id}' is not a stable kebab/colon id`);
    if (seen.has(id)) failures.push(`duplicate scenario id after expansion: '${id}'`);
    seen.add(id);
  }

  reported.push(
    `expanded scenarios: ${expanded.length} (${staticScenarios.length} static, ${expanded.length - staticScenarios.length} dynamic); exemptions: ${exemptions.length}`
  );

  return {
    failures,
    reported,
    summary: {
      testFilesOnDisk: onDisk.length,
      correlatedSpecs: correlated.size,
      staticScenarios: staticScenarios.length,
      dynamicScenarios: dynamicScenarios.length,
      expandedScenarios: expanded.length,
      exemptions: exemptions.length,
    },
  };
}

function writeReport(root, stage, payload) {
  const dir = join(root, "docs/evidence/e2e");
  mkdirSync(dir, { recursive: true });
  const base = join(dir, `${stage}-scenario-manifest-latest`);
  writeFileSync(`${base}.json`, JSON.stringify(payload, null, 2) + "\n");
  const lines = [
    `# E2E scenario-manifest validation — ${stage}`,
    "",
    "Generated (ADR-0075 / ADR-ACT-0285 closure). DO NOT EDIT — regenerate via `npm run e2e:scenario:validate`.",
    "",
    `- Result: **${payload.result}**`,
    `- Failures (block make all): ${payload.failures.length}`,
    "",
  ];
  if (payload.failures.length) {
    lines.push("## Failures", "");
    for (const f of payload.failures) lines.push(`- ❌ ${f}`);
    lines.push("");
  }
  if (payload.reported.length) {
    lines.push("## Notes", "");
    for (const r of payload.reported) lines.push(`- ${r}`);
    lines.push("");
  }
  lines.push("## Summary", "");
  for (const [k, v] of Object.entries(payload.summary)) lines.push(`- ${k}: ${v}`);
  lines.push("");
  writeFileSync(`${base}.md`, lines.join("\n"));
}

function main() {
  const rootArg = process.argv.slice(2).find((a) => !a.startsWith("-"));
  const root = resolve(rootArg ?? ".");
  const stage = (process.env["STAGE"] || process.env["ENV"] || "local").toLowerCase();
  const r = validateScenarioManifest(root);
  const result = r.failures.length ? "FAILED" : "PASSED";
  const payload = {
    stage,
    validator: "scenario-manifest",
    result,
    ...r,
    generatedFor: "ADR-0075 / ADR-ACT-0285",
  };
  writeReport(root, stage, payload);
  const tag = result === "PASSED" ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m";
  console.log(
    `${tag} e2e scenario-manifest: ${result} — ${r.failures.length} failure(s) → docs/evidence/e2e/${stage}-scenario-manifest-latest.md`
  );
  for (const f of r.failures) console.log(`    \x1b[31m✗\x1b[0m ${f}`);
  process.exit(result === "FAILED" ? 1 : 0);
}

const invokedDirectly =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) main();
