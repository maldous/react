import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import {
  fetchOrganisationProfile,
  updateOrganisationProfile,
} from "../../features/organisation/organisation-client";

// ADR-ACT-0199: the SPA talks to the BFF GraphQL boundary over fetch.
const server = setupServer();
beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const PROFILE = {
  id: "00000000-0000-0000-0000-000000000001",
  slug: "fixture-org",
  displayName: "Fixture Organisation",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("organisation-client (GraphQL transport)", () => {
  it("fetchOrganisationProfile posts a query and unwraps data.organisationProfile", async () => {
    let captured: { query?: string } = {};
    server.use(
      http.post("/api/graphql", async ({ request }) => {
        captured = (await request.json()) as { query?: string };
        return HttpResponse.json({ data: { organisationProfile: PROFILE } });
      })
    );
    const result = await fetchOrganisationProfile();
    expect(result).toEqual(PROFILE);
    expect(captured.query).toContain("organisationProfile");
  });

  it("updateOrganisationProfile sends the displayName variable and unwraps the mutation", async () => {
    let captured: { variables?: Record<string, unknown> } = {};
    server.use(
      http.post("/api/graphql", async ({ request }) => {
        captured = (await request.json()) as { variables?: Record<string, unknown> };
        return HttpResponse.json({
          data: { updateOrganisationProfile: { ...PROFILE, displayName: "New Name" } },
        });
      })
    );
    const result = await updateOrganisationProfile({ displayName: "New Name" });
    expect(result.displayName).toBe("New Name");
    expect(captured.variables).toEqual({ displayName: "New Name" });
  });

  it("throws with code/status on a non-2xx transport response (auth failure)", async () => {
    server.use(
      http.post("/api/graphql", () =>
        HttpResponse.json({ code: "FORBIDDEN", message: "nope" }, { status: 403 })
      )
    );
    await expect(fetchOrganisationProfile()).rejects.toMatchObject({
      code: "FORBIDDEN",
      status: 403,
    });
  });

  it("throws when the response carries GraphQL errors", async () => {
    server.use(
      http.post("/api/graphql", () =>
        HttpResponse.json({ errors: [{ message: "Display name must be at least 2 characters" }] })
      )
    );
    await expect(updateOrganisationProfile({ displayName: "x" })).rejects.toThrow(
      /at least 2 characters/
    );
  });
});
