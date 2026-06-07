/**
 * Unit tests for resource-policies usecase (T-C3).
 * Covers getResourcePolicies, setResourcePolicy, and audit-before-mutation ordering.
 */
import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { getResourcePolicies, setResourcePolicy } from "../../src/usecases/resource-policies.ts";
import type { ResourcePolicy } from "@platform/authorisation-runtime";

const baseInput = {
  organisationId: "org-1",
  realmName: "realm-1",
  actorId: "actor-1",
  actorRoles: ["system_admin"],
};

const fakePolicy: ResourcePolicy = {
  type: "allow",
  name: "allow-all",
  resources: ["*"],
  roles: ["system_admin"],
};

// ── getResourcePolicies ───────────────────────────────────────────────────────
describe("getResourcePolicies", () => {
  it("returns policies from adapter", async () => {
    const adapter = { getResourcePolicy: mock.fn(async () => [fakePolicy]) } as never;
    const result = await getResourcePolicies(baseInput, { adapter });
    assert.deepEqual(result, { policies: [fakePolicy] });
    assert.equal((adapter.getResourcePolicy as ReturnType<typeof mock.fn>).mock.calls.length, 1);
  });

  it("returns empty array when no policies exist", async () => {
    const adapter = { getResourcePolicy: mock.fn(async () => []) } as never;
    const result = await getResourcePolicies(baseInput, { adapter });
    assert.deepEqual(result, { policies: [] });
  });
});

// ── setResourcePolicy ─────────────────────────────────────────────────────────
describe("setResourcePolicy", () => {
  it("returns { kind: 'ok' } on success", async () => {
    const callOrder: string[] = [];
    const audit = {
      emit: mock.fn(async () => {
        callOrder.push("audit");
      }),
    } as never;
    const adapter = {
      getResourcePolicy: mock.fn(async () => []),
      setResourcePolicy: mock.fn(async () => {
        callOrder.push("adapter");
      }),
    } as never;
    const result = await setResourcePolicy(
      { ...baseInput, resourceName: "organisation:profile", policy: fakePolicy },
      { adapter, audit }
    );
    assert.deepEqual(result, { kind: "ok" });
  });

  it("emits audit BEFORE calling adapter (ordering guarantee)", async () => {
    const callOrder: string[] = [];
    const audit = {
      emit: mock.fn(async () => {
        callOrder.push("audit");
      }),
    } as never;
    const adapter = {
      getResourcePolicy: mock.fn(async () => []),
      setResourcePolicy: mock.fn(async () => {
        callOrder.push("adapter");
      }),
    } as never;
    await setResourcePolicy(
      { ...baseInput, resourceName: "organisation:members", policy: fakePolicy },
      { adapter, audit }
    );
    assert.deepEqual(callOrder, ["audit", "adapter"], "audit must fire before adapter mutation");
  });

  it("does NOT call adapter when audit throws", async () => {
    const audit = {
      emit: mock.fn(async () => {
        throw new Error("audit failure");
      }),
    } as never;
    const adapter = {
      getResourcePolicy: mock.fn(async () => []),
      setResourcePolicy: mock.fn(async () => {}),
    } as never;
    await assert.rejects(
      () =>
        setResourcePolicy(
          { ...baseInput, resourceName: "org:profile", policy: fakePolicy },
          { adapter, audit }
        ),
      /audit failure/
    );
    assert.equal(
      (adapter.setResourcePolicy as ReturnType<typeof mock.fn>).mock.calls.length,
      0,
      "adapter must not be called when audit fails"
    );
  });

  it("accepts wildcard '*' resource name", async () => {
    const audit = { emit: mock.fn(async () => {}) } as never;
    const adapter = {
      getResourcePolicy: mock.fn(async () => []),
      setResourcePolicy: mock.fn(async () => {}),
    } as never;
    const result = await setResourcePolicy(
      { ...baseInput, resourceName: "*", policy: fakePolicy },
      { adapter, audit }
    );
    assert.deepEqual(result, { kind: "ok" });
  });
});
