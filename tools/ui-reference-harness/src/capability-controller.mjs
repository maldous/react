// Semantic Reference Harness — capability controller (pure, node-testable).
//
// Resolves the deterministic selection protocol axes into a view model the renderers consume.
// Axes (from the URL: /?capability=groups&persona=tenant-admin&state=loaded):
//   capability  → which harness-enabled capability record
//   persona     → which persona's permission set is active
//   state       → which data/validation/server-response state to render
//
// No React, no fetch — just the decision logic, so it is unit-testable under `node --test`.

export const DATA_STATES = [
  "loading",
  "empty",
  "loaded",
  "submitting",
  "success",
  "validationError",
  "forbidden",
  "serverError",
  "degraded",
];

export function getHarness(capability) {
  return capability && capability.harness ? capability.harness : null;
}

export function findPersona(harness, personaId) {
  return (harness?.personas || []).find((p) => p.personaId === personaId) || null;
}

export function personaPermissions(harness, personaId) {
  return new Set(findPersona(harness, personaId)?.permissions || []);
}

/** The query whose result feeds the primary table (first read query). */
export function primaryQuery(harness) {
  return (harness?.queries || [])[0] || null;
}

export function canRead(harness, personaId) {
  const q = primaryQuery(harness);
  if (!q || !q.requiredPermission) return true;
  return personaPermissions(harness, personaId).has(q.requiredPermission);
}

export function canRunCommand(harness, personaId, commandId) {
  const cmd = (harness?.commands || []).find((c) => c.commandId === commandId);
  if (!cmd || !cmd.requiredPermission) return false;
  return personaPermissions(harness, personaId).has(cmd.requiredPermission);
}

/** The mutating commands this persona is allowed to invoke (drives which action buttons render). */
export function allowedCommands(harness, personaId) {
  return (harness?.commands || []).filter((c) => canRunCommand(harness, personaId, c.commandId));
}

export function pickFixture(harness, state, method = "GET") {
  const m = String(method).toUpperCase();
  return (
    (harness?.fixtures || []).find(
      (f) => f.state === state && String(f.method || "GET").toUpperCase() === m
    ) || null
  );
}

/**
 * Compute the view the harness should render. A persona without read permission is always
 * forbidden, regardless of the requested data state (a denied read can never show a table).
 */
export function resolveView({ capability, persona, state }) {
  const harness = getHarness(capability);
  if (!harness) return { kind: "not-harness-enabled" };

  const dataState = DATA_STATES.includes(state) ? state : "loaded";

  if (!canRead(harness, persona)) {
    return { kind: "forbidden", harness, persona, dataState: "forbidden" };
  }

  const listFixture =
    pickFixture(harness, dataState, "GET") || pickFixture(harness, "loaded", "GET");
  return {
    kind: "capability",
    harness,
    persona,
    dataState,
    listFixture,
    table: harness.table || (harness.tables ? harness.tables[0] : null),
    commands: allowedCommands(harness, persona),
    fields: harness.fields || [],
  };
}

export function parseSelection(search, defaults = {}) {
  const params = new URLSearchParams(search || "");
  return {
    capability: params.get("capability") || defaults.capability || null,
    persona: params.get("persona") || defaults.persona || null,
    state: params.get("state") || defaults.state || "loaded",
  };
}
