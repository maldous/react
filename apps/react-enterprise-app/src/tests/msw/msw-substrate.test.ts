import { describe, it, expect } from "vitest";
import {
  server,
  sessionHandler,
  themeHandler,
  createGraphqlHandler,
  graphqlErrorResolver,
  operationNameFromQuery,
  tenantThemeFixture,
  organisationFixture,
} from "../../msw";

// Locks the MSW substrate contract (ADR-0019). These are the helpers feature
// tests rely on; if their shape changes, this fails before downstream tests do.

describe("MSW session substrate", () => {
  it("baseline /api/session is unauthenticated (401)", async () => {
    const res = await fetch("/api/session");
    expect(res.status).toBe(401);
  });

  it("sessionHandler selects a persona dynamically", async () => {
    server.use(sessionHandler("viewer"));
    const res = await fetch("/api/session");
    const actor = (await res.json()) as { roles: string[]; permissions: string[] };
    expect(actor.roles).toEqual(["viewer"]);
    expect(actor.permissions).toContain("organisation.read");
    expect(actor.permissions).not.toContain("organisation.update");
  });
});

describe("MSW theme substrate", () => {
  it("themeHandler returns a tenant brand", async () => {
    server.use(themeHandler(tenantThemeFixture));
    const res = await fetch("/api/theme");
    const theme = (await res.json()) as { primaryColour: string };
    expect(theme.primaryColour).toBe(tenantThemeFixture.primaryColour);
  });
});

describe("MSW GraphQL substrate", () => {
  it("operationNameFromQuery reads the operation name", () => {
    expect(operationNameFromQuery("query OrganisationProfile { organisationProfile { id } }")).toBe(
      "OrganisationProfile"
    );
    expect(
      operationNameFromQuery("mutation UpdateOrganisationProfile($displayName: String!) { x }")
    ).toBe("UpdateOrganisationProfile");
  });

  it("default GraphQL handler resolves a known operation by name", async () => {
    const res = await fetch("/api/graphql", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "query OrganisationProfile { organisationProfile { id } }" }),
    });
    const body = (await res.json()) as { data: { organisationProfile: { slug: string } } };
    expect(body.data.organisationProfile.slug).toBe(organisationFixture.slug);
  });

  it("per-operation override can model a GraphQL error", async () => {
    server.use(createGraphqlHandler({ OrganisationProfile: graphqlErrorResolver("boom") }));
    const res = await fetch("/api/graphql", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "query OrganisationProfile { organisationProfile { id } }" }),
    });
    const body = (await res.json()) as { errors: Array<{ message: string }> };
    expect(body.errors[0]?.message).toBe("boom");
  });
});
