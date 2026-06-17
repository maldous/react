// ADR-ACT-0285 (closure) — shared scenario-manifest model.
//
// The ONE place that loads e2e/scenario-manifest.json + e2e/persona-registry.json +
// e2e/suite-registry.json and expands the dynamic suites into a DETERMINISTIC, validated
// set of runtime scenarios. Imported by BOTH tools/e2e/validate-scenario-manifest (the
// gate) and tools/e2e/observability-correlation (the runtime completeness + Tempo harness)
// so the canonical id set and per-stage required set are computed identically in both.
//
// Pure Node, no app runtime. Exported functions are unit-tested in
// tools/e2e/validate-scenario-manifest/tests/.

import { readFileSync } from "node:fs";
import { join } from "node:path";

export const LADDER = ["dev", "test", "staging", "prod"];

/** Stages at and above `stageMin` in ladder order (a suite runs at stageMin and up). */
export function ladderFrom(stageMin) {
  const i = LADDER.indexOf(stageMin);
  return i < 0 ? [] : LADDER.slice(i);
}

const readJson = (root, rel) => JSON.parse(readFileSync(join(root, rel), "utf8"));

export function loadModel(root = ".") {
  const manifest = readJson(root, "e2e/scenario-manifest.json");
  const personaRegistry = readJson(root, "e2e/persona-registry.json");
  const suiteRegistry = readJson(root, "e2e/suite-registry.json");
  return { manifest, personaRegistry, suiteRegistry };
}

// ---------------------------------------------------------------------------
// Named "is this expansion required to be observed" rules. A rule is deterministic
// from the persona-registry + stage and MUST mirror the spec's real run/skip logic so
// a legitimately-skipped persona is NOT marked required (no false missing-scenario).
// ---------------------------------------------------------------------------

/** persona-matrix-denial: a persona expansion deterministically emits a correlatable
 *  WARN denial (http.request.rejected) at `stage` iff the persona actually logs in (or
 *  is unauthenticated/fixture) AND probes at least one resolvable forbidden API there. */
export function personaMatrixDenialRequired(persona, stage) {
  const ref = persona.provisionRef ?? "";
  if (/NOT YET PROVISIONED/i.test(ref)) return false;
  const username = (ref.match(/keycloak:(\S+)/) || [])[1] || null;
  const isCrossTenant = persona.personaId === "scaffold-cross-tenant";
  // Mirror persona-matrix.spec.ts: real personas with no distinct keycloak account are
  // SKIPPED (expired-session / entitlement / quota / rate variations); cross-tenant
  // reuses the tenant-admin login.
  const hasLogin =
    persona.authMode === "fixture" ||
    persona.authMode === "unauthenticated" ||
    Boolean(username) ||
    isCrossTenant;
  if (!hasLogin) return false;
  for (const apiRaw of persona.forbiddenApiAccess ?? []) {
    if (String(apiRaw).startsWith("tenant-b:")) {
      // The tenant-B FQDN probe runs only where its TLS is reachable — the prod apex
      // (*.aldous.info Universal SSL). Skipped elsewhere, so required only at prod.
      if (isCrossTenant && stage === "prod") return true;
      continue;
    }
    const m = /^(GET|POST|PATCH|PUT|DELETE)\s+(\S+)$/.exec(String(apiRaw));
    if (m && !m[2].includes(":")) return true;
  }
  return false;
}

export const REQUIRED_RULES = {
  "persona-matrix-denial": personaMatrixDenialRequired,
};

// ---------------------------------------------------------------------------
// Expansion
// ---------------------------------------------------------------------------

function suiteStageMin(suiteRegistry, suiteId) {
  const s = (suiteRegistry.suites ?? []).find((x) => x.id === suiteId);
  return s ? s.stageMin : null;
}

/**
 * Expand the manifest into the full set of runtime scenarios. Each entry:
 *   { scenarioId, suiteId, file, source, stages[], authMode, persona|null, dynamic,
 *     expectedLogs[], expectedTraces|null, expectedSentryEvents[], correlation:{logs,traces},
 *     surfaces[], owner }
 * correlation.logs is resolved to required|best-effort|none (a "conditional" dynamic rule
 * is evaluated PER STAGE inside requiredLog/TraceScenarioIds, not here, because it varies
 * by stage; `correlation.logsRule` carries the rule name for that evaluation).
 */
export function expand(model) {
  const { manifest, personaRegistry, suiteRegistry } = model;
  const out = [];

  for (const s of manifest.scenarios ?? []) {
    out.push({
      scenarioId: s.scenarioId,
      suiteId: s.suiteId ?? null,
      file: s.file,
      source: s.source ?? "playwright",
      stages: s.stages ?? [],
      authMode: s.authMode,
      persona: null,
      dynamic: false,
      surfaces: s.surfaces ?? [],
      expectedLogs: s.expectedLogs ?? [],
      expectedTraces: s.expectedTraces ?? null,
      expectedSentryEvents: s.expectedSentryEvents ?? [],
      correlation: {
        logs: s.correlation?.logs ?? "none",
        traces: s.correlation?.traces ?? "none",
        logsRule: s.correlation?.logsRequiredRule ?? null,
      },
      owner: s.owner ?? "",
    });
  }

  for (const d of manifest.dynamicScenarios ?? []) {
    const stageMin = suiteStageMin(suiteRegistry, d.suiteId);
    const groupStages = stageMin ? ladderFrom(stageMin) : LADDER;
    const sel = d.dynamicSource?.selector ?? {};
    const stageField = d.dynamicSource?.stageField ?? "stageAllowed";
    const idField = d.dynamicSource?.idField ?? "personaId";
    const tmpl = d.dynamicSource?.idTemplate ?? `${d.baseScenarioId}:{${idField}}`;
    const collection = personaRegistry[d.dynamicSource?.collection ?? "personas"] ?? [];

    for (const item of collection) {
      const id = item[idField];
      if ((sel.excludeIdPrefixes ?? []).some((p) => String(id).startsWith(p))) continue;
      if ((sel.excludeAuthModes ?? []).includes(item.authMode)) continue;
      // expansion runs where BOTH the persona is allowed AND the suite/group runs.
      const stages = (item[stageField] ?? []).filter((st) => groupStages.includes(st));
      if (stages.length === 0) continue;
      out.push({
        scenarioId: tmpl.replace(`{${idField}}`, id),
        suiteId: d.suiteId ?? null,
        file: d.file,
        source: d.source ?? "playwright",
        stages,
        authMode: item.authMode,
        persona: item,
        dynamic: true,
        surfaces: d.surfaces ?? [],
        expectedLogs: d.expectedLogs ?? [],
        expectedTraces: d.expectedTraces ?? null,
        expectedSentryEvents: d.expectedSentryEvents ?? [],
        correlation: {
          logs: d.correlation?.logs ?? "none",
          traces: d.correlation?.traces ?? "none",
          logsRule: d.correlation?.logsRequiredRule ?? null,
        },
        owner: d.owner ?? "",
      });
    }
  }

  return out;
}

/** Resolve a scenario's effective log requirement at a given stage:
 *  required | best-effort | none. A "conditional" entry consults its named rule. */
export function logRequirementForStage(scenario, stage) {
  const c = scenario.correlation?.logs ?? "none";
  if (c !== "conditional") return c;
  const rule = REQUIRED_RULES[scenario.correlation.logsRule];
  if (!rule) return "best-effort"; // unknown rule never hard-fails
  return scenario.persona && rule(scenario.persona, stage) ? "required" : "best-effort";
}

export function traceRequirementForStage(scenario, _stage) {
  return scenario.correlation?.traces ?? "none";
}

export function scenariosForStage(expanded, stage) {
  return expanded.filter((s) => s.stages.includes(stage));
}

export function requiredLogScenarioIds(expanded, stage) {
  return scenariosForStage(expanded, stage)
    .filter((s) => logRequirementForStage(s, stage) === "required")
    .map((s) => s.scenarioId);
}

export function requiredTraceScenarios(expanded, stage) {
  return scenariosForStage(expanded, stage).filter(
    (s) => traceRequirementForStage(s, stage) === "required" && s.expectedTraces
  );
}

/** Every canonical scenario id (static + all dynamic expansions). Used for uniqueness. */
export function allScenarioIds(expanded) {
  return expanded.map((s) => s.scenarioId);
}
