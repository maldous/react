import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ClickHouseAnalyticsAdapter } from "../src/index.ts";

function makeFakeClient() {
  return {
    insert: async () => ({}),
    close: async () => {},
  };
}

const NOW = new Date().toISOString();

describe("ClickHouseAnalyticsAdapter", () => {
  it("insert resolves without error", async () => {
    const adapter = new ClickHouseAnalyticsAdapter(
      { database: "analytics", table: "events" },
      makeFakeClient() as never
    );
    await assert.doesNotReject(() =>
      adapter.insert({
        type: "page_view",
        userId: "user-1",
        anonymousId: null,
        page: "/home",
        referrer: null,
        timestamp: NOW,
      })
    );
  });

  it("bulkInsert with empty array is a no-op", async () => {
    const calls: unknown[][] = [];
    const fakeClient = {
      insert: async (args: unknown) => {
        calls.push([args]);
        return {};
      },
      close: async () => {},
    };
    const adapter = new ClickHouseAnalyticsAdapter(
      { database: "analytics", table: "events" },
      fakeClient as never
    );
    await adapter.bulkInsert([]);
    assert.strictEqual(calls.length, 0);
  });

  it("bulkInsert sends all events", async () => {
    let inserted: unknown[] = [];
    const fakeClient = {
      insert: async ({ values }: { values: unknown[] }) => {
        inserted = values;
        return {};
      },
      close: async () => {},
    };
    const adapter = new ClickHouseAnalyticsAdapter(
      { database: "analytics", table: "events" },
      fakeClient as never
    );
    await adapter.bulkInsert([
      {
        type: "track",
        event: "click",
        userId: "u1",
        anonymousId: null,
        properties: {},
        timestamp: NOW,
      },
      {
        type: "track",
        event: "submit",
        userId: "u2",
        anonymousId: null,
        properties: {},
        timestamp: NOW,
      },
    ]);
    assert.strictEqual(inserted.length, 2);
  });
});
