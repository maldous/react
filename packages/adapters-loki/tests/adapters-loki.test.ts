import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildLogQL, parseLokiResponse, LokiLogQueryAdapter } from "../src/index.ts";

// ── buildLogQL (pure) ──────────────────────────────────────────────────────────
describe("buildLogQL", () => {
  it("falls back to a present-service selector when no label filter is given", () => {
    assert.equal(buildLogQL({}), '{service=~".+"}');
  });

  it("uses low-cardinality fields (service, level) as Loki labels", () => {
    assert.equal(
      buildLogQL({ service: "platform-api", level: "error" }),
      '{service="platform-api", level="error"}'
    );
  });

  it("adds a line filter for free text", () => {
    assert.equal(
      buildLogQL({ service: "platform-api", text: "boom" }),
      '{service="platform-api"} |= "boom"'
    );
  });

  it("queries high-cardinality fields via `| json` filters, never as labels", () => {
    const expr = buildLogQL({ requestId: "req-123", traceId: "trace-9" });
    assert.equal(expr, '{service=~".+"} | json | requestId="req-123" | traceId="trace-9"');
    assert.ok(!expr.includes("requestId=" + '"req-123"' + "}"), "requestId must not be a label");
  });

  it("combines labels, text, and json filters in order", () => {
    const expr = buildLogQL({
      service: "platform-api",
      level: "info",
      text: "http.request.complete",
      tenantId: "t-1",
      actorId: "a-1",
    });
    assert.equal(
      expr,
      '{service="platform-api", level="info"} |= "http.request.complete" | json | tenantId="t-1" | actorId="a-1"'
    );
  });

  it("escapes quotes and backslashes in values", () => {
    assert.equal(buildLogQL({ text: 'a"b\\c' }), '{service=~".+"} |= "a\\"b\\\\c"');
  });
});

// ── parseLokiResponse (pure) ────────────────────────────────────────────────────
describe("parseLokiResponse", () => {
  const body = {
    status: "success",
    data: {
      resultType: "streams",
      result: [
        {
          stream: { service: "platform-api", level: "info" },
          values: [
            ["1700000001000000000", '{"requestId":"r2","msg":"second"}'],
            ["1700000000000000000", '{"requestId":"r1","msg":"first"}'],
          ],
        },
        {
          stream: { service: "caddy", level: "info" },
          values: [["1700000002000000000", "plain text caddy line"]],
        },
      ],
    },
  };

  it("flattens streams into entries with ISO timestamps and labels", () => {
    const entries = parseLokiResponse(body);
    assert.equal(entries.length, 3);
    assert.equal(entries[0]?.labels["service"], "caddy");
    assert.ok(entries[0]?.timestamp.startsWith("2023-11-14T"));
  });

  it("parses JSON lines into fields and leaves non-JSON fields empty", () => {
    const entries = parseLokiResponse(body);
    const jsonEntry = entries.find((e) => e.line.includes("second"));
    assert.equal(jsonEntry?.fields["requestId"], "r2");
    const plain = entries.find((e) => e.line.startsWith("plain text"));
    assert.deepEqual(plain?.fields, {});
  });

  it("sorts newest first", () => {
    const entries = parseLokiResponse(body);
    assert.ok(entries[0]!.timestamp >= entries[1]!.timestamp);
    assert.ok(entries[1]!.timestamp >= entries[2]!.timestamp);
  });

  it("tolerates an empty / malformed body", () => {
    assert.deepEqual(parseLokiResponse({}), []);
    assert.deepEqual(parseLokiResponse(null), []);
  });
});

// ── LokiLogQueryAdapter (injected fetch) ─────────────────────────────────────────
describe("LokiLogQueryAdapter", () => {
  it("calls query_range with the built LogQL and parses the result", async () => {
    let capturedUrl = "";
    const fakeFetch = (async (url: string) => {
      capturedUrl = String(url);
      return new Response(
        JSON.stringify({
          data: {
            result: [
              {
                stream: { service: "platform-api" },
                values: [["1700000000000000000", '{"requestId":"r1"}']],
              },
            ],
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as unknown as typeof fetch;

    const adapter = new LokiLogQueryAdapter({ url: "http://loki:3100/" }, fakeFetch);
    const result = await adapter.search({ service: "platform-api", requestId: "r1", limit: 50 });

    assert.equal(result.entries.length, 1);
    assert.equal(result.entries[0]?.fields["requestId"], "r1");
    assert.ok(capturedUrl.startsWith("http://loki:3100/loki/api/v1/query_range?"));
    // URLSearchParams form-encodes spaces as "+"; restore them before matching.
    const decoded = decodeURIComponent(capturedUrl.replace(/\+/g, " "));
    assert.ok(decoded.includes('{service="platform-api"} | json | requestId="r1"'));
    assert.ok(capturedUrl.includes("limit=50"));
    assert.ok(capturedUrl.includes("direction=backward"));
  });

  it("throws on a non-2xx Loki response", async () => {
    const fakeFetch = (async () => new Response(null, { status: 503 })) as unknown as typeof fetch;
    const adapter = new LokiLogQueryAdapter({ url: "http://loki:3100" }, fakeFetch);
    await assert.rejects(() => adapter.search({ text: "x" }), /Loki query failed: 503/);
  });
});
