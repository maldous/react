/**
 * Unit tests for the admin log search use case (ADR-ACT-0194).
 * Verifies limit clamping, direction normalisation, and port delegation with a
 * fake LogSearchPort (no Loki required).
 */
import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import type { LogSearchQuery, LogSearchResult } from "@platform/adapters-loki";
import { normaliseLogSearchQuery, searchLogs } from "../../src/usecases/logs.ts";

describe("normaliseLogSearchQuery", () => {
  it("defaults limit to 100 and direction to backward", () => {
    const out = normaliseLogSearchQuery({});
    assert.equal(out.limit, 100);
    assert.equal(out.direction, "backward");
  });

  it("clamps limit to the 1000 maximum", () => {
    assert.equal(normaliseLogSearchQuery({ limit: 999999 }).limit, 1000);
  });

  it("floors a fractional limit and enforces a minimum of 1", () => {
    assert.equal(normaliseLogSearchQuery({ limit: 0 }).limit, 1);
    assert.equal(normaliseLogSearchQuery({ limit: 5.9 }).limit, 5);
  });

  it("only accepts 'forward' as a non-default direction", () => {
    assert.equal(normaliseLogSearchQuery({ direction: "forward" }).direction, "forward");
    assert.equal(normaliseLogSearchQuery({ direction: "sideways" as never }).direction, "backward");
  });

  it("preserves search criteria", () => {
    const out = normaliseLogSearchQuery({ requestId: "r-1", service: "platform-api" });
    assert.equal(out.requestId, "r-1");
    assert.equal(out.service, "platform-api");
  });
});

describe("searchLogs", () => {
  it("delegates the normalised query to the Loki port", async () => {
    const result: LogSearchResult = { entries: [] };
    let received: LogSearchQuery | undefined;
    const loki = {
      search: mock.fn(async (q: LogSearchQuery) => {
        received = q;
        return result;
      }),
    };
    const out = await searchLogs({ requestId: "r-1", limit: 99999 }, { loki });
    assert.equal(out, result);
    assert.equal(received?.requestId, "r-1");
    assert.equal(received?.limit, 1000, "limit must be clamped before reaching the port");
    assert.equal((loki.search as ReturnType<typeof mock.fn>).mock.calls.length, 1);
  });
});
