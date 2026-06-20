import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolveView,
  canRead,
  canRunCommand,
  allowedCommands,
  pickFixture,
  parseSelection,
} from "../src/capability-controller.mjs";

function capability() {
  return {
    capabilityId: "x-groups",
    harness: {
      capabilityKey: "groups",
      personas: [
        { personaId: "admin", permissions: ["g.read", "g.create", "g.delete"] },
        { personaId: "viewer", permissions: ["g.read"] },
        { personaId: "none", permissions: [] },
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
        },
        {
          commandId: "delete",
          method: "DELETE",
          endpoint: "/api/org/groups/:id",
          requiredPermission: "g.delete",
          resultingState: "success",
        },
      ],
      fields: [{ name: "name", label: "Name" }],
      table: {
        collectionKey: "groups",
        idField: "id",
        columns: [{ field: "name", label: "Name" }],
      },
      states: ["loaded", "empty", "forbidden", "serverError"],
      fixtures: [
        {
          state: "loaded",
          route: "/api/org/groups",
          method: "GET",
          status: 200,
          body: { groups: [{ id: "1", name: "Eng" }] },
        },
        {
          state: "empty",
          route: "/api/org/groups",
          method: "GET",
          status: 200,
          body: { groups: [] },
        },
      ],
    },
  };
}

test("parseSelection reads the axes from the query string", () => {
  assert.deepEqual(parseSelection("?capability=groups&persona=admin&state=empty"), {
    capability: "groups",
    persona: "admin",
    state: "empty",
  });
});

test("canRead honours the read permission", () => {
  const h = capability().harness;
  assert.equal(canRead(h, "admin"), true);
  assert.equal(canRead(h, "viewer"), true);
  assert.equal(canRead(h, "none"), false);
});

test("canRunCommand and allowedCommands reflect persona permissions", () => {
  const h = capability().harness;
  assert.equal(canRunCommand(h, "admin", "create"), true);
  assert.equal(canRunCommand(h, "viewer", "create"), false);
  assert.deepEqual(
    allowedCommands(h, "viewer").map((c) => c.commandId),
    []
  );
  assert.deepEqual(
    allowedCommands(h, "admin")
      .map((c) => c.commandId)
      .sort(),
    ["create", "delete"]
  );
});

test("resolveView forbids a persona without read regardless of requested state", () => {
  const v = resolveView({ capability: capability(), persona: "none", state: "loaded" });
  assert.equal(v.kind, "forbidden");
});

test("resolveView returns a capability view with the matching fixture + allowed commands", () => {
  const v = resolveView({ capability: capability(), persona: "admin", state: "loaded" });
  assert.equal(v.kind, "capability");
  assert.equal(v.listFixture.body.groups[0].name, "Eng");
  assert.deepEqual(v.commands.map((c) => c.commandId).sort(), ["create", "delete"]);
});

test("resolveView falls back to the loaded fixture for an unknown state", () => {
  const v = resolveView({ capability: capability(), persona: "admin", state: "nonsense" });
  assert.equal(v.dataState, "loaded");
});

test("pickFixture selects by state + method", () => {
  const h = capability().harness;
  assert.equal(pickFixture(h, "empty", "GET").body.groups.length, 0);
  assert.equal(pickFixture(h, "missing", "GET"), null);
});

test("a capability with no harness block is reported as not-harness-enabled", () => {
  const v = resolveView({
    capability: { capabilityId: "plain" },
    persona: "admin",
    state: "loaded",
  });
  assert.equal(v.kind, "not-harness-enabled");
});
