// Semantic Reference Harness — definition validator (pure, node-testable).
//
// Enforces the harness machine-readable contract over every capability record that carries a
// `harness` block in docs/v2-foundation/ui-capability-model.json. This is the dedicated
// schema/cross-reference rule the slice requires — it is NOT folded into v2-readiness R14
// (which only presence-checks the base capability schema). The v2-readiness rule
// r20-harness-semantics.mjs and the node tests under tools/ui-reference-harness/tests/ both
// call into here so there is a single source of truth for "what makes a harness definition valid".
//
// A harness block describes a capability's semantics independently of any product screen:
//   capabilityKey, personas[], permissions[], queries[], commands[], fields[], validation[],
//   states[], transitions[], fixtures[], accessibleNames[], keyboardBehaviour[],
//   errorPresentation, journeys[]  (+ optional `complete: true`).

const REQUIRED_HARNESS_FIELDS = [
  "capabilityKey",
  "personas",
  "permissions",
  "queries",
  "commands",
  "fields",
  "validation",
  "states",
  "transitions",
  "fixtures",
  "accessibleNames",
  "keyboardBehaviour",
  "errorPresentation",
  "journeys",
];

// Normalise a route so /api/org/groups/:groupId and /api/org/groups/{groupId} both match the
// declared contract endpoint regardless of the path-parameter syntax used.
function normaliseRoute(route) {
  return String(route ?? "")
    .replace(/\{[^/}]+\}/g, "*")
    .replace(/:[^/]+/g, "*")
    .replace(/\/+$/, "");
}

const contractKey = (method, route) => `${String(method).toUpperCase()} ${normaliseRoute(route)}`;

function finding(capabilityKey, message) {
  return { capabilityKey, message };
}

/**
 * Validate every harness block. `capabilities` is the array from ui-capability-model.json.
 * Options carry the filesystem/package facts the pure rules cannot see by themselves:
 *   - sourceFiles: relative paths under the harness src/ tree (for the bespoke-code check #8)
 *   - packageScripts: the repo package.json `scripts` map (for the proof-command check #9)
 *   - exceptions: capabilityKeys explicitly allowed to ship bespoke harness code
 * Returns a flat array of { capabilityKey, message } — empty means valid.
 */
export function validateHarnessDefinitions(capabilities, options = {}) {
  const { sourceFiles = [], packageScripts = {}, exceptions = [] } = options;
  const out = [];
  const harnessCaps = (capabilities || []).filter((c) => c && c.harness);

  // #1 duplicate capability keys
  const seenKeys = new Set();
  for (const cap of harnessCaps) {
    const key = cap.harness.capabilityKey;
    if (key && seenKeys.has(key)) out.push(finding(key, "duplicate harness capabilityKey"));
    if (key) seenKeys.add(key);
  }

  for (const cap of harnessCaps) {
    const h = cap.harness;
    const key = h.capabilityKey || cap.capabilityId || "<harness>";

    for (const f of REQUIRED_HARNESS_FIELDS)
      if (!(f in h)) out.push(finding(key, `harness block missing required field "${f}"`));

    const declaredStates = new Set(Array.isArray(h.states) ? h.states : []);
    const refState = (state, where) => {
      if (state != null && !declaredStates.has(state))
        out.push(finding(key, `${where} references undeclared state "${state}"`)); // #2
    };

    const commandIds = new Set((h.commands || []).map((c) => c.commandId));
    const personaIds = new Set((h.personas || []).map((p) => p.personaId));
    const contracts = new Set([
      ...(h.queries || []).map((q) => contractKey(q.method || "GET", q.endpoint)),
      ...(h.commands || []).map((c) => contractKey(c.method, c.endpoint)),
    ]);

    // #3 every command resolves to a declared resulting state (+ declared failure states #2)
    for (const c of h.commands || []) {
      if (!c.resultingState)
        out.push(finding(key, `command "${c.commandId}" has no resultingState`));
      else refState(c.resultingState, `command "${c.commandId}".resultingState`);
      for (const fs of c.failureStates || [])
        refState(fs, `command "${c.commandId}".failureStates`);
    }

    // transitions reference declared states only (#2)
    for (const t of h.transitions || []) {
      refState(t.from, "transition.from");
      refState(t.to, "transition.to");
    }

    // #4 every validation rule associates an accessible error
    for (const v of h.validation || []) {
      if (!v.errorId || !v.accessibleErrorAssociation)
        out.push(
          finding(key, `validation for "${v.field}/${v.rule}" lacks accessible error association`)
        );
    }

    // #5 every permission has both allowed and denied persona coverage
    for (const p of h.permissions || []) {
      const allowed = Array.isArray(p.allowedPersonas) ? p.allowedPersonas.length : 0;
      const denied = Array.isArray(p.deniedPersonas) ? p.deniedPersonas.length : 0;
      if (allowed === 0 || denied === 0)
        out.push(finding(key, `permission "${p.permission}" lacks allowed+denied coverage`));
    }

    // #6 every fixture route matches a declared query/command contract
    for (const fx of h.fixtures || []) {
      refState(fx.state, "fixture.state");
      if (!contracts.has(contractKey(fx.method || "GET", fx.route)))
        out.push(
          finding(
            key,
            `fixture "${fx.state}" route ${fx.method} ${fx.route} matches no declared contract`
          )
        );
    }

    // #7 every journey references known commands, persona and states
    for (const j of h.journeys || []) {
      if (j.persona && !personaIds.has(j.persona))
        out.push(
          finding(key, `journey "${j.journeyId}" references unknown persona "${j.persona}"`)
        );
      for (const cmd of j.coversCommands || [])
        if (!commandIds.has(cmd))
          out.push(finding(key, `journey "${j.journeyId}" references unknown command "${cmd}"`));
      for (const st of j.coversStates || []) refState(st, `journey "${j.journeyId}".coversStates`);
    }

    // #9 a capability marked complete must declare a proof command (present in package scripts)
    //    and a journey carrying that proof command + a spec file. (The journey actually PASSING
    //    is proven by running ui:harness:e2e — it cannot be asserted statically.)
    if (h.complete === true) {
      const proofJourneys = (h.journeys || []).filter((j) => j.proofCommand && j.spec);
      if (proofJourneys.length === 0)
        out.push(finding(key, "complete capability has no journey with a proofCommand + spec"));
      for (const j of proofJourneys)
        if (!(j.proofCommand in packageScripts))
          out.push(
            finding(
              key,
              `journey "${j.journeyId}" proofCommand "${j.proofCommand}" is not a package script`
            )
          );
    }
  }

  // #8 no bespoke per-capability harness code outside the recorded exceptions
  const allow = new Set(exceptions);
  for (const rel of sourceFiles) {
    const base = String(rel).split("/").pop() || "";
    const stem = base.replace(/\.(tsx?|mjs|jsx?)$/i, "");
    for (const key of seenKeys)
      if (stem === key && !allow.has(key))
        out.push(
          finding(key, `bespoke capability harness file "${rel}" without a recorded exception`)
        );
  }

  return out;
}

export const __test = { normaliseRoute, contractKey, REQUIRED_HARNESS_FIELDS };
