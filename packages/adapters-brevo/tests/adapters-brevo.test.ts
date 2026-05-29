import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { BrevoEmailAdapter } from "../src/index.ts";

function makeFakeFetch(ok: boolean, status: number, data: unknown) {
  return async () => ({
    ok,
    status,
    json: async () => data,
  });
}

describe("BrevoEmailAdapter", () => {
  it("sends email and returns messageId", async () => {
    const adapter = new BrevoEmailAdapter(
      { apiKey: "test-key", defaultFromAddress: "noreply@test.com" },
      makeFakeFetch(true, 201, { messageId: "brevo-123" }) as typeof fetch
    );
    const result = await adapter.send({
      from: { address: "noreply@test.com" },
      to: [{ address: "user@example.com" }],
      subject: "Hello",
      text: "World",
    });
    assert.strictEqual(result.messageId, "brevo-123");
  });

  it("throws EmailError on API failure", async () => {
    const adapter = new BrevoEmailAdapter(
      { apiKey: "bad-key", defaultFromAddress: "a@b.com" },
      makeFakeFetch(false, 401, { message: "Unauthorized" }) as typeof fetch
    );
    await assert.rejects(
      () =>
        adapter.send({
          from: { address: "a@b.com" },
          to: [{ address: "b@c.com" }],
          subject: "Hi",
          text: "Body",
        }),
      { name: "EmailError" }
    );
  });

  it("uses fallback messageId when response has none", async () => {
    const adapter = new BrevoEmailAdapter(
      { apiKey: "key", defaultFromAddress: "a@b.com" },
      makeFakeFetch(true, 201, {}) as typeof fetch
    );
    const result = await adapter.send({
      from: { address: "a@b.com" },
      to: [{ address: "b@c.com" }],
      subject: "Hi",
      text: "Body",
    });
    assert.ok(typeof result.messageId === "string" && result.messageId.length > 0);
  });
});
