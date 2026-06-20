import { test } from "node:test";
import assert from "node:assert/strict";
import { validateHarnessDefinitions } from "../src/validate-definition.mjs";

function validCapability() {
  return {
    capabilityId: "x-groups",
    harness: {
      capabilityKey: "groups",
      personas: [
        { personaId: "admin", permissions: ["g.read", "g.create", "g.update", "g.delete"] },
        { personaId: "viewer", permissions: ["g.read"] },
        { personaId: "none", permissions: [] },
      ],
      permissions: [
        { permission: "g.read", allowedPersonas: ["admin", "viewer"], deniedPersonas: ["none"] },
        { permission: "g.create", allowedPersonas: ["admin"], deniedPersonas: ["viewer", "none"] },
      ],
      queries: [
        {
          queryId: "list",
          method: "GET",
          endpoint: "/api/org/groups",
          requiredPermission: "g.read",
        },
      ],
      commands: [
        {
          commandId: "create",
          method: "POST",
          endpoint: "/api/org/groups",
          requiredPermission: "g.create",
          resultingState: "success",
          failureStates: ["validationError", "serverError"],
        },
        {
          commandId: "delete",
          method: "DELETE",
          endpoint: "/api/org/groups/:groupId",
          requiredPermission: "g.delete",
          resultingState: "success",
          failureStates: ["serverError"],
        },
      ],
      fields: [
        {
          name: "name",
          label: "Name",
          validation: ["required"],
          errorId: "name-error",
          testId: "name",
        },
      ],
      validation: [
        {
          field: "name",
          rule: "required",
          errorId: "name-error",
          accessibleErrorAssociation: "aria-describedby",
        },
      ],
      states: [
        "loading",
        "empty",
        "loaded",
        "submitting",
        "success",
        "validationError",
        "forbidden",
        "serverError",
      ],
      transitions: [
        { from: "loaded", on: "create", to: "submitting" },
        { from: "submitting", on: "ok", to: "success" },
      ],
      fixtures: [
        {
          state: "loaded",
          route: "/api/org/groups",
          method: "GET",
          status: 200,
          body: { groups: [] },
        },
        {
          state: "validationError",
          route: "/api/org/groups",
          method: "POST",
          status: 422,
          triggerField: "name",
          triggerValue: "taken",
          body: { fieldErrors: { name: "taken" } },
        },
      ],
      accessibleNames: [{ control: "action-create", role: "button", name: "Create group" }],
      keyboardBehaviour: ["Tab reaches all controls"],
      errorPresentation: { strategy: "aria-describedby", liveRegion: "polite" },
      journeys: [
        {
          journeyId: "crud",
          persona: "admin",
          coversCommands: ["create", "delete"],
          coversStates: ["loaded", "success"],
          proofCommand: "proof:ui-semantic-groups",
          spec: "tools/ui-reference-harness/playwright/groups.spec.ts",
        },
      ],
    },
  };
}

const clone = (o) => JSON.parse(JSON.stringify(o));
const messages = (caps, opts) => validateHarnessDefinitions(caps, opts).map((f) => f.message);

test("a fully-specified harness definition is valid", () => {
  assert.deepEqual(validateHarnessDefinitions([validCapability()]), []);
});

test("#1 duplicate capabilityKey fires", () => {
  const a = validCapability();
  const b = validCapability();
  assert.match(messages([a, b]).join("\n"), /duplicate harness capabilityKey/);
});

test("#2 undeclared state reference fires", () => {
  const c = clone(validCapability());
  c.harness.transitions.push({ from: "loaded", on: "x", to: "ghost" });
  assert.match(messages([c]).join("\n"), /undeclared state "ghost"/);
});

test("#3 command without resultingState fires", () => {
  const c = clone(validCapability());
  delete c.harness.commands[0].resultingState;
  assert.match(messages([c]).join("\n"), /has no resultingState/);
});

test("#4 validation without accessible error association fires", () => {
  const c = clone(validCapability());
  delete c.harness.validation[0].accessibleErrorAssociation;
  assert.match(messages([c]).join("\n"), /lacks accessible error association/);
});

test("#5 permission without allowed+denied coverage fires", () => {
  const c = clone(validCapability());
  c.harness.permissions[0].deniedPersonas = [];
  assert.match(messages([c]).join("\n"), /lacks allowed\+denied coverage/);
});

test("#6 fixture route not matching a declared contract fires", () => {
  const c = clone(validCapability());
  c.harness.fixtures.push({
    state: "loaded",
    route: "/api/org/unknown",
    method: "GET",
    status: 200,
  });
  assert.match(messages([c]).join("\n"), /matches no declared contract/);
});

test("#7 journey referencing an unknown command fires", () => {
  const c = clone(validCapability());
  c.harness.journeys[0].coversCommands.push("ghost-command");
  assert.match(messages([c]).join("\n"), /unknown command "ghost-command"/);
});

test("#7 journey referencing an unknown persona fires", () => {
  const c = clone(validCapability());
  c.harness.journeys[0].persona = "ghost-persona";
  assert.match(messages([c]).join("\n"), /unknown persona "ghost-persona"/);
});

test("#9 complete capability needs a proof journey present in package scripts", () => {
  const c = clone(validCapability());
  c.harness.complete = true;
  // proofCommand exists in the journey but is not a known package script → fires
  assert.match(messages([c], { packageScripts: {} }).join("\n"), /is not a package script/);
  // with the script registered, the complete capability validates
  assert.deepEqual(
    validateHarnessDefinitions([c], { packageScripts: { "proof:ui-semantic-groups": "node x" } }),
    []
  );
});

test("#8 bespoke per-capability harness file without an exception fires", () => {
  const c = validCapability();
  const msgs = messages([c], { sourceFiles: ["src/renderers/groups.tsx"] });
  assert.match(msgs.join("\n"), /bespoke capability harness file/);
  // recorded exception clears it
  assert.deepEqual(
    validateHarnessDefinitions([c], {
      sourceFiles: ["src/renderers/groups.tsx"],
      exceptions: ["groups"],
    }),
    []
  );
});
