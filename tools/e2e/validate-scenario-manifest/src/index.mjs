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
import {
  loadModel,
  expand,
  allScenarioIds,
  ladderFrom,
  REQUIRED_RULES,
} from "../../scenario-manifest.mjs";

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
  for (const e of exemptions) {
    if (!existsSync(join(root, e.file)))
      failures.push(`exemption references missing file: ${e.file}`);
    if (!e.reason || e.reason.length < 20)
      failures.push(`exemption for '${e.file}' lacks a substantive reason`);
    if (correlated.has(e.file))
      failures.push(
        `file '${e.file}' imports the correlation fixture but is only EXEMPTED — a correlated spec must declare a scenario`
      );
  }

  // every correlated spec must be a real scenario/dynamic entry AND declare an explicit id
  for (const f of correlated) {
    const kinds = claims.get(f) ?? [];
    const hasRealScenario = kinds.some(
      (k) => k.startsWith("scenario:") || k.startsWith("dynamic:")
    );
    if (!hasRealScenario)
      failures.push(`correlated spec '${f}' has no scenario/dynamic manifest entry`);
    const src = readFileSync(join(root, f), "utf8");
    const explicit =
      /test\.use\(\s*\{\s*scenarioId\s*:/.test(src) || /\bscenario\(\s*[`"']/.test(src);
    if (!explicit)
      failures.push(
        `correlated spec '${f}' does not declare an explicit scenarioId (test.use({scenarioId}) or scenario(...)) — it would fall back to a sanitised title`
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
