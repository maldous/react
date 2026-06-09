import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { searchLogs } from "../../features/admin-logs/admin-logs-client";

const server = setupServer();
beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("admin-logs-client (ADR-ACT-0195)", () => {
  it("sends non-empty filters as query params and returns entries", async () => {
    let capturedUrl = "";
    server.use(
      http.get("/api/admin/logs/search", ({ request }) => {
        capturedUrl = request.url;
        return HttpResponse.json({
          entries: [
            {
              timestamp: "2026-06-09T00:00:00.000Z",
              line: '{"msg":"hi","requestId":"r-1"}',
              fields: { msg: "hi", requestId: "r-1" },
              labels: { service: "platform-api", level: "info" },
            },
          ],
        });
      })
    );

    const result = await searchLogs({ service: "platform-api", requestId: "r-1", text: "" });
    expect(result.entries).toHaveLength(1);
    const url = new URL(capturedUrl);
    expect(url.searchParams.get("service")).toBe("platform-api");
    expect(url.searchParams.get("requestId")).toBe("r-1");
    // Empty filter values are omitted.
    expect(url.searchParams.has("text")).toBe(false);
  });

  it("throws with code/status on a non-2xx response", async () => {
    server.use(
      http.get("/api/admin/logs/search", () =>
        HttpResponse.json({ code: "FORBIDDEN", message: "nope" }, { status: 403 })
      )
    );
    await expect(searchLogs({ requestId: "x" })).rejects.toMatchObject({
      code: "FORBIDDEN",
      status: 403,
    });
  });
});
