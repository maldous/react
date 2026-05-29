import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { NotificationError, createInMemoryNotificationPort } from "../src/index.ts";

describe("createInMemoryNotificationPort", () => {
  it("send returns a delivery id", async () => {
    const port = createInMemoryNotificationPort();
    const result = await port.send({
      userId: "user-1",
      type: "alert",
      title: "Test",
      body: "Body text",
      channels: ["in-app"],
    });
    assert.ok(typeof result.deliveryId === "string" && result.deliveryId.length > 0);
    assert.deepStrictEqual(result.channels, ["in-app"]);
  });
  it("sent notifications are retrievable", async () => {
    const port = createInMemoryNotificationPort();
    await port.send({ userId: "user-1", type: "alert", title: "Hello", body: "World", channels: ["in-app"] });
    const sent = port.getSent("user-1");
    assert.strictEqual(sent.length, 1);
    assert.strictEqual(sent[0]!.title, "Hello");
  });
  it("getSent filters by userId", async () => {
    const port = createInMemoryNotificationPort();
    await port.send({ userId: "user-1", type: "alert", title: "A", body: "B", channels: ["in-app"] });
    await port.send({ userId: "user-2", type: "alert", title: "C", body: "D", channels: ["push"] });
    assert.strictEqual(port.getSent("user-1").length, 1);
    assert.strictEqual(port.getSent("user-2").length, 1);
  });
  it("markRead resolves without error", async () => {
    const port = createInMemoryNotificationPort();
    await assert.doesNotReject(() => port.markRead(["id-1", "id-2"]));
  });
});

describe("NotificationError", () => {
  it("is an Error with correct name", () => {
    const err = new NotificationError("fail");
    assert.ok(err instanceof Error);
    assert.strictEqual(err.name, "NotificationError");
  });
});
