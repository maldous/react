#!/usr/bin/env node
// ADR-0075 / ADR-ACT-0285 — E2E coverage + persona + UI-contract validator.
//
// Subcommands: coverage | personas | ui-contract | all
// Cross-checks the e2e/*.json registries against the live platform inventories
// (USF registry, admin nav, clickthrough policy, role/permission model, the test
// files on disk) and FAILS (exit 1) on structural coverage gaps so `make all`
// cannot pass with hidden/dishonest coverage. Writes honest evidence reports to
// docs/evidence/e2e/. Missing/deferred/mock-only capabilities do not fail but are
// reported. Pure Node — parses JSON + regex-greps TS source; no app runtime.

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from "node:fs";
import { resolve, join, relative } from "node:path";
import process from "node:process";

const SUBCOMMANDS = ["coverage", "personas", "ui-contract", "all"];
const rootArg = process.argv.slice(2).find((a) => !a.startsWith("-") && !SUBCOMMANDS.includes(a));
const ROOT = resolve(rootArg ?? ".");
const EVIDENCE_DIR = join(ROOT, "docs/evidence/e2e");

// ---------------------------------------------------------------------------
// Loaders
// ---------------------------------------------------------------------------
const readJson = (p) => JSON.parse(readFileSync(join(ROOT, p), "utf8"));

function listTestFiles() {
  const out = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(test|spec)\.ts$/.test(e.name)) out.push(relative(ROOT, p));
    }
  };
  walk(join(ROOT, "e2e"));
  return out.sort();
}

// Parse ADMIN_NAV_ITEMS { to: "...", ... permission: "..." } from AdminLayout.tsx
function parseAdminNav() {
  const src = readFileSync(
    join(ROOT, "apps/react-enterprise-app/src/components/AdminLayout.tsx"),
    "utf8"
  );
  const items = [];
  const re = /\{\s*to:\s*"([^"]+)"[^}]*?permission:\s*"([^"]+)"/g;
  let m;
  while ((m = re.exec(src)) !== null) items.push({ route: m[1], permission: m[2] });
  return items;
}

// Parse CLICKTHROUGH_SERVICES id + classification from service-clickthrough.ts
function parseClickthrough() {
  const src = readFileSync(
    join(ROOT, "apps/platform-api/src/usecases/service-clickthrough.ts"),
    "utf8"
  );
  const out = [];
  const re = /id:\s*"([^"]+)",\s*\n\s*resource:\s*"[^"]+",\s*\n\s*classification:\s*"([^"]+)"/g;
  let m;
  while ((m = re.exec(src)) !== null) out.push({ id: m[1], classification: m[2] });
  return out;
}

// Parse the role names from packages/domain-identity ROLE_PERMISSION_MAP keys
function parseRoles() {
  const src = readFileSync(join(ROOT, "packages/domain-identity/src/index.ts"), "utf8");
  const block = src.split("ROLE_PERMISSION_MAP")[1] ?? "";
  const roles = new Set();
  const re = /"([a-z-]+)":\s*\[/g;
  let m;
  while ((m = re.exec(block.split("};")[0] ?? "")) !== null) roles.add(m[1]);
  return [...roles];
}

function listProofScripts() {
  const dir = join(ROOT, "apps/platform-api/scripts");
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => /-runtime-proof\.ts$/.test(f));
}

// ---------------------------------------------------------------------------
// Report helpers
// ---------------------------------------------------------------------------
function writeReport(stage, name, payload) {
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  const base = join(EVIDENCE_DIR, `${stage}-${name}-latest`);
  writeFileSync(`${base}.json`, JSON.stringify(payload, null, 2) + "\n");
  const md = renderMd(name, payload);
  writeFileSync(`${base}.md`, md);
}

function renderMd(name, p) {
  const lines = [
    `# E2E ${name} coverage — ${p.stage}`,
    "",
    `Generated for git evidence (ADR-0075 / ADR-ACT-0285). DO NOT EDIT — regenerate via \`npm run e2e:${name === "coverage" ? "coverage:validate" : name === "personas" ? "personas:validate" : "ui:contract:validate"}\`.`,
    "",
    `- Result: **${p.result}**`,
    `- Failures (block make all): ${p.failures.length}`,
    `- Reported gaps (honest, non-blocking this phase): ${p.reported.length}`,
    "",
  ];
  if (p.failures.length) {
    lines.push("## Failures", "");
    for (const f of p.failures) lines.push(`- ❌ ${f}`);
    lines.push("");
  }
  if (p.reported.length) {
    lines.push("## Reported gaps (tracked, not yet blocking)", "");
    for (const r of p.reported) lines.push(`- ⚠️ ${r}`);
    lines.push("");
  }
  if (p.summary) {
    lines.push("## Summary", "");
    for (const [k, v] of Object.entries(p.summary)) lines.push(`- ${k}: ${v}`);
    lines.push("");
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// coverage
// ---------------------------------------------------------------------------
function validateCoverage(stage) {
  const failures = [];
  const reported = [];
  const suiteReg = readJson("e2e/suite-registry.json");
  const usf = readJson("docs/evidence/platform/universal-service-foundation-registry.json");
  const suites = suiteReg.suites;
  const exemptions = new Map((suiteReg.capabilityExemptions ?? []).map((e) => [e.capability, e]));

  // 1. every test file on disk has a registry entry
  const registered = new Set(suites.map((s) => s.file));
  const onDisk = listTestFiles();
  for (const f of onDisk)
    if (!registered.has(f)) failures.push(`test file has no suite-registry entry: ${f}`);
  // 2. every registry entry points at a real file
  for (const s of suites)
    if (!existsSync(join(ROOT, s.file)))
      failures.push(`suite '${s.id}' references missing file: ${s.file}`);
  // 3. required-field integrity
  const REQUIRED = [
    "id",
    "file",
    "stageMin",
    "authMode",
    "destructive",
    "surfaces",
    "requiredCapabilities",
    "expectedLogs",
    "expectedMetrics",
    "expectedTraces",
    "expectedSentryEvents",
    "failureModes",
    "owner",
  ];
  for (const s of suites)
    for (const k of REQUIRED)
      if (!(k in s)) failures.push(`suite '${s.id}' missing required field: ${k}`);

  // 4. delivered/locally-proven capabilities must be covered or exempted
  const coveredCaps = new Set(suites.flatMap((s) => s.requiredCapabilities));
  const mustCover = usf.capabilities.filter(
    (c) => c.status === "delivered" || c.status === "locally proven"
  );
  for (const c of mustCover) {
    if (coveredCaps.has(c.capability)) continue;
    if (exemptions.has(c.capability)) {
      reported.push(
        `capability '${c.capability}' (${c.status}) exempt: ${exemptions.get(c.capability).reason}`
      );
      continue;
    }
    failures.push(
      `delivered/locally-proven capability '${c.capability}' (${c.status}) has NO E2E suite and NO exemption`
    );
  }
  // honest report of non-must-cover capabilities
  for (const c of usf.capabilities) {
    if (c.status !== "delivered" && c.status !== "locally proven")
      reported.push(
        `capability '${c.capability}' status=${c.status} — not required to have E2E (honest report)`
      );
  }
  // exemption integrity: exemption for a capability that doesn't exist
  const allCaps = new Set(usf.capabilities.map((c) => c.capability));
  for (const e of suiteReg.capabilityExemptions ?? [])
    if (!allCaps.has(e.capability))
      failures.push(`exemption references unknown capability: ${e.capability}`);

  // 5. admin nav routes covered (by ui-contract surface route or suite surface)
  const ui = readJson("e2e/ui-contract.json");
  const uiRoutes = new Set(ui.surfaces.map((s) => s.route));
  const suiteSurfaces = new Set(suites.flatMap((s) => s.surfaces));
  for (const nav of parseAdminNav()) {
    const covered =
      uiRoutes.has(nav.route) || [...suiteSurfaces].some((x) => x === `route:${nav.route}`);
    if (!covered)
      failures.push(
        `admin nav route '${nav.route}' has no ui-contract surface and no suite coverage`
      );
  }
  // 6. clickthrough services (exposed) covered
  for (const ct of parseClickthrough()) {
    if (ct.classification === "not_exposed") continue;
    const covered = [...suiteSurfaces].some(
      (x) =>
        x === `clickthrough:${ct.id}` || x === "clickthrough:tools" || x === "clickthrough:keycloak"
    );
    if (!covered)
      failures.push(
        `clickthrough service '${ct.id}' (${ct.classification}) has no reachability/blocked E2E coverage`
      );
  }
  // 7. proof scripts — honest report of mapping
  reported.push(
    `proof scripts present: ${listProofScripts().length} (capability-evidence mapping audited in ADR-ACT-0285 Phase 5)`
  );

  return finalize(stage, "coverage", failures, reported, {
    testFiles: onDisk.length,
    suites: suites.length,
    "delivered+locallyProven capabilities": mustCover.length,
    coveredCapabilities: mustCover.filter((c) => coveredCaps.has(c.capability)).length,
    exemptCapabilities: mustCover.filter(
      (c) => !coveredCaps.has(c.capability) && exemptions.has(c.capability)
    ).length,
    adminNavRoutes: parseAdminNav().length,
    clickthroughExposed: parseClickthrough().filter((c) => c.classification !== "not_exposed")
      .length,
  });
}

// ---------------------------------------------------------------------------
// personas
// ---------------------------------------------------------------------------
function validatePersonas(stage) {
  const failures = [];
  const reported = [];
  const reg = readJson("e2e/persona-registry.json");
  const personas = reg.personas;
  const a11yVocab = reg.accessibilityProfileVocabulary;
  const roles = parseRoles();

  // 1. every role has a persona
  const personaRoles = new Set(personas.flatMap((p) => p.roles));
  for (const r of roles)
    if (!personaRoles.has(r)) failures.push(`role '${r}' has no persona in persona-registry`);
  // 2. every accessibility profile has a persona
  const personaA11y = new Set(personas.map((p) => p.accessibilityProfile).filter(Boolean));
  for (const a of a11yVocab)
    if (!personaA11y.has(a)) failures.push(`accessibility profile '${a}' has no persona`);
  // 3. fixture personas must NOT be allowed at staging/prod (real-auth only there)
  for (const p of personas) {
    if (
      p.authMode === "fixture" &&
      (p.stageAllowed.includes("staging") || p.stageAllowed.includes("prod"))
    )
      failures.push(
        `persona '${p.personaId}' is authMode=fixture but stageAllowed includes staging/prod (fixture sessions forbidden in real-auth stages)`
      );
    // 4. real/mixed personas at staging/prod must declare a provisionRef
    if (
      (p.authMode === "real" || p.authMode === "mixed") &&
      (p.stageAllowed.includes("staging") || p.stageAllowed.includes("prod")) &&
      !p.provisionRef
    )
      failures.push(
        `persona '${p.personaId}' runs at staging/prod with real auth but has no provisionRef (scaffold account)`
      );
    // accessibility profile must be in vocab or null
    if (p.accessibilityProfile && !a11yVocab.includes(p.accessibilityProfile))
      failures.push(
        `persona '${p.personaId}' has unknown accessibilityProfile: ${p.accessibilityProfile}`
      );
  }
  // 5. positive + negative coverage per admin-nav permission (REPORTED this phase; escalates Phase 6)
  const positives = new Set(personas.flatMap((p) => p.permissions));
  const negatives = new Set(personas.flatMap((p) => p.deniedPermissions));
  for (const nav of parseAdminNav()) {
    if (!positives.has(nav.permission))
      reported.push(
        `permission '${nav.permission}' (route ${nav.route}) has no persona with positive coverage`
      );
    if (!negatives.has(nav.permission))
      reported.push(
        `permission '${nav.permission}' (route ${nav.route}) has no persona with negative (denied) coverage`
      );
  }
  // 6. scaffold provisioning honesty: personas whose provisionRef says NOT YET PROVISIONED
  for (const p of personas)
    if (typeof p.provisionRef === "string" && /NOT YET PROVISIONED/i.test(p.provisionRef))
      reported.push(
        `persona '${p.personaId}' scaffold account NOT YET PROVISIONED — must exist before staging/prod real-auth execution (Phase 6)`
      );

  return finalize(stage, "persona", failures, reported, {
    personas: personas.length,
    roles: roles.length,
    rolesCovered: roles.filter((r) => personaRoles.has(r)).length,
    accessibilityProfiles: a11yVocab.length,
    a11yProfilesCovered: a11yVocab.filter((a) => personaA11y.has(a)).length,
  });
}

// ---------------------------------------------------------------------------
// ui-contract
// ---------------------------------------------------------------------------
function validateUiContract(stage) {
  const failures = [];
  const reported = [];
  const ui = readJson("e2e/ui-contract.json");
  const usf = readJson("docs/evidence/platform/universal-service-foundation-registry.json");
  const allCaps = new Set(usf.capabilities.map((c) => c.capability));
  const personas = new Set(readJson("e2e/persona-registry.json").personas.map((p) => p.personaId));
  const forbidden = ui.globalPolicy.forbiddenBrittleSelectors;
  const surfaces = ui.surfaces;

  // 1. every admin nav route has a ui-contract surface
  const surfaceRoutes = new Set(surfaces.map((s) => s.route));
  for (const nav of parseAdminNav())
    if (!surfaceRoutes.has(nav.route))
      failures.push(
        `admin nav route '${nav.route}' has no ui-contract surface (new page without declared E2E intent)`
      );

  for (const s of surfaces) {
    // 2. owning capability must exist
    if (s.owningCapability && !allCaps.has(s.owningCapability))
      failures.push(
        `surface '${s.surfaceId}' owningCapability '${s.owningCapability}' not in USF registry`
      );
    // 3. supported personas must exist
    for (const p of s.supportedPersonas ?? [])
      if (!personas.has(p))
        failures.push(`surface '${s.surfaceId}' references unknown persona: ${p}`);
    // 4. permission-gated surface with negativeTestRequired must have a denied persona
    if (s.negativeTestRequired && (s.requiredPermissions ?? []).length > 0) {
      const hasDenied = readJson("e2e/persona-registry.json").personas.some(
        (p) =>
          (p.forbiddenRoutes ?? []).includes(s.route) ||
          (p.forbiddenNavItems ?? []).includes(s.route)
      );
      if (!hasDenied)
        reported.push(
          `surface '${s.surfaceId}' requires a negative test but no persona declares it forbidden (Phase 6 execution)`
        );
    }
    // 5. destructive actions must declare safe stage coverage
    if ((s.destructiveActions ?? []).length > 0 && (s.safeStageCoverage ?? []).length === 0)
      failures.push(
        `surface '${s.surfaceId}' has destructive actions but no safeStageCoverage rule`
      );
    // 6. accessibility contract required
    if (!(s.accessibilityExpectations ?? []).length)
      failures.push(`surface '${s.surfaceId}' has no accessibility contract`);
    // 7. migration deprecated/removed require a note
    if ((s.migration === "deprecated" || s.migration === "removed") && !s.migrationNote)
      failures.push(`surface '${s.surfaceId}' migration=${s.migration} without a migrationNote`);
    // 8. allowed selectors must not be brittle
    for (const sel of s.allowedSelectors ?? []) {
      for (const bad of forbidden) {
        const pat = bad.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        if (
          new RegExp(pat).test(sel) &&
          !sel.startsWith("role:") &&
          !sel.startsWith("testid:") &&
          !sel.startsWith("accessible-name:")
        )
          failures.push(
            `surface '${s.surfaceId}' allowedSelector '${sel}' matches forbidden brittle pattern '${bad}'`
          );
      }
    }
  }
  return finalize(stage, "ui-contract", failures, reported, {
    surfaces: surfaces.length,
    adminNavRoutes: parseAdminNav().length,
    deprecatedSurfaces: surfaces.filter((s) => s.migration !== "active").length,
  });
}

// ---------------------------------------------------------------------------
function finalize(stage, name, failures, reported, summary) {
  const result = failures.length ? "FAILED" : "PASSED";
  const payload = {
    stage,
    validator: name,
    result,
    failures,
    reported,
    summary,
    generatedFor: "ADR-0075 / ADR-ACT-0285",
  };
  writeReport(stage, name, payload);
  return payload;
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
const cmd =
  process.argv.find((a) => ["coverage", "personas", "ui-contract", "all"].includes(a)) ?? "all";
const stage = (process.env["STAGE"] || process.env["ENV"] || "local").toLowerCase();

const run = [];
if (cmd === "coverage" || cmd === "all") run.push(validateCoverage(stage));
if (cmd === "personas" || cmd === "all") run.push(validatePersonas(stage));
if (cmd === "ui-contract" || cmd === "all") run.push(validateUiContract(stage));

let failed = false;
for (const r of run) {
  const tag = r.result === "PASSED" ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m";
  console.log(
    `${tag} e2e ${r.validator}: ${r.result} — ${r.failures.length} failure(s), ${r.reported.length} reported gap(s) → docs/evidence/e2e/${stage}-${r.validator}-latest.md`
  );
  for (const f of r.failures) console.log(`    \x1b[31m✗\x1b[0m ${f}`);
  if (r.result === "FAILED") failed = true;
}
process.exit(failed ? 1 : 0);
