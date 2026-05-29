import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { EmailError, createNoopEmailPort, isValidEmailAddress } from "../src/index.ts";

describe("isValidEmailAddress", () => {
  it("accepts valid email", () => assert.ok(isValidEmailAddress("user@example.com")));
  it("rejects string without @", () => assert.ok(!isValidEmailAddress("notanemail")));
  it("rejects empty string", () => assert.ok(!isValidEmailAddress("")));
});

describe("createNoopEmailPort", () => {
  it("resolves without error and returns messageId", async () => {
    const port = createNoopEmailPort();
    const result = await port.send({
      from: { address: "from@example.com" },
      to: [{ address: "to@example.com" }],
      subject: "Test",
      text: "Body",
    });
    assert.ok(typeof result.messageId === "string" && result.messageId.length > 0);
  });
});

describe("EmailError", () => {
  it("is an Error with correct name", () => {
    const err = new EmailError("Failed to send");
    assert.ok(err instanceof Error);
    assert.strictEqual(err.name, "EmailError");
  });
  it("stores cause", () => {
    const cause = new Error("underlying");
    const err = new EmailError("outer", cause);
    assert.strictEqual(err.cause, cause);
  });
});
