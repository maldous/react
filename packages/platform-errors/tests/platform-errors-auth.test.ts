import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  assertPermission,
  assertAuthenticated,
  ForbiddenError,
  UnauthorizedError,
} from "../src/index.ts";

describe("assertPermission", () => {
  it("does not throw when the permission is present", () => {
    assert.doesNotThrow(() => {
      assertPermission(["organisation.read", "member.read"], "organisation.read");
    });
  });

  it("throws ForbiddenError when the permission is missing", () => {
    assert.throws(
      () => {
        assertPermission(["member.read"], "organisation.update");
      },
      (err: unknown) => {
        assert.ok(err instanceof ForbiddenError);
        assert.equal(err.code, "FORBIDDEN");
        assert.ok(err.message.includes("organisation.update"));
        return true;
      }
    );
  });

  it("includes the required permission in safeDetails", () => {
    let thrown: ForbiddenError | undefined;
    try {
      assertPermission([], "admin.access");
    } catch (e) {
      if (e instanceof ForbiddenError) thrown = e;
    }
    assert.ok(thrown !== undefined);
    assert.deepEqual(thrown.safeDetails, { required: "admin.access" });
  });

  it("includes context in internalDetails when provided", () => {
    let thrown: ForbiddenError | undefined;
    try {
      assertPermission([], "audit.read", { requestId: "req-123", actorId: "actor-456" });
    } catch (e) {
      if (e instanceof ForbiddenError) thrown = e;
    }
    assert.ok(thrown !== undefined);
    assert.deepEqual(thrown.internalDetails, {
      requestId: "req-123",
      actorId: "actor-456",
    });
  });

  it("does not include internalDetails when context is not provided", () => {
    let thrown: ForbiddenError | undefined;
    try {
      assertPermission([], "audit.read");
    } catch (e) {
      if (e instanceof ForbiddenError) thrown = e;
    }
    assert.ok(thrown !== undefined);
    assert.equal(thrown.internalDetails, undefined);
  });
});

describe("assertAuthenticated", () => {
  it("does not throw when actor has userId", () => {
    assert.doesNotThrow(() => {
      assertAuthenticated({ userId: "user-1" });
    });
  });

  it("throws UnauthorizedError when actor is null", () => {
    assert.throws(
      () => {
        assertAuthenticated(null);
      },
      (err: unknown) => {
        assert.ok(err instanceof UnauthorizedError);
        assert.equal(err.code, "UNAUTHORIZED");
        return true;
      }
    );
  });

  it("throws UnauthorizedError when actor is undefined", () => {
    assert.throws(
      () => {
        assertAuthenticated(undefined);
      },
      (err: unknown) => {
        assert.ok(err instanceof UnauthorizedError);
        return true;
      }
    );
  });

  it("throws UnauthorizedError when userId is empty string", () => {
    assert.throws(
      () => {
        assertAuthenticated({ userId: "" });
      },
      (err: unknown) => {
        assert.ok(err instanceof UnauthorizedError);
        return true;
      }
    );
  });
});
