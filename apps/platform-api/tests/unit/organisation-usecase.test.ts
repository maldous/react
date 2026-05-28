import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  getOrganisationProfile,
  updateOrganisationDisplayName,
} from "../../src/usecases/organisation.ts";
import { NotFoundError, ValidationError } from "@platform/platform-errors";
import type { OrganisationRepository } from "../../src/ports/organisation-repository.ts";
import type { OrganisationProfile } from "@platform/contracts-organisation";

const FIXTURE_PROFILE: OrganisationProfile = {
  id: "00000000-0000-0000-0000-000000000001",
  slug: "fixture-org",
  displayName: "Fixture Organisation",
  createdAt: "2024-01-01T00:00:00.000Z",
  updatedAt: "2024-01-01T00:00:00.000Z",
};

function makeFakeRepo(overrides: Partial<OrganisationRepository> = {}): OrganisationRepository {
  return {
    getById: async () => FIXTURE_PROFILE,
    updateDisplayName: async (_id, displayName) => ({ ...FIXTURE_PROFILE, displayName }),
    ...overrides,
  };
}

describe("getOrganisationProfile", () => {
  it("returns profile from repository", async () => {
    const repo = makeFakeRepo();
    const result = await getOrganisationProfile(
      { organisationId: FIXTURE_PROFILE.id },
      { organisations: repo }
    );
    assert.equal(result.id, FIXTURE_PROFILE.id);
    assert.equal(result.slug, FIXTURE_PROFILE.slug);
  });

  it("throws NotFoundError when repository returns null", async () => {
    const repo = makeFakeRepo({ getById: async () => null });
    await assert.rejects(
      () =>
        getOrganisationProfile(
          { organisationId: "00000000-0000-0000-0000-000000000099" },
          { organisations: repo }
        ),
      (err: unknown) => err instanceof NotFoundError
    );
  });

  it("does not import pg directly", async () => {
    const sourcePath = fileURLToPath(
      new URL("../../src/usecases/organisation.ts", import.meta.url)
    );
    const source = await readFile(sourcePath, "utf8");
    assert.ok(!source.includes('from "pg"'), "use case must not import pg (double quotes)");
    assert.ok(!source.includes("from 'pg'"), "use case must not import pg (single quotes)");
  });
});

describe("updateOrganisationDisplayName", () => {
  it("returns updated profile from repository", async () => {
    const repo = makeFakeRepo();
    const result = await updateOrganisationDisplayName(
      { organisationId: FIXTURE_PROFILE.id, displayName: "New Name" },
      { organisations: repo }
    );
    assert.equal(result.displayName, "New Name");
  });

  it("trims whitespace from display name before calling repo", async () => {
    let captured = "";
    const repo = makeFakeRepo({
      updateDisplayName: async (_id, dn) => {
        captured = dn;
        return { ...FIXTURE_PROFILE, displayName: dn };
      },
    });
    await updateOrganisationDisplayName(
      { organisationId: FIXTURE_PROFILE.id, displayName: "  Trimmed  " },
      { organisations: repo }
    );
    assert.equal(captured, "Trimmed");
  });

  it("throws ValidationError for empty display name", async () => {
    const repo = makeFakeRepo();
    await assert.rejects(
      () =>
        updateOrganisationDisplayName(
          { organisationId: FIXTURE_PROFILE.id, displayName: "" },
          { organisations: repo }
        ),
      (err: unknown) => err instanceof ValidationError
    );
  });

  it("throws ValidationError for whitespace-only display name", async () => {
    const repo = makeFakeRepo();
    await assert.rejects(
      () =>
        updateOrganisationDisplayName(
          { organisationId: FIXTURE_PROFILE.id, displayName: "   " },
          { organisations: repo }
        ),
      (err: unknown) => err instanceof ValidationError
    );
  });

  it("throws ValidationError for display name shorter than 2 chars", async () => {
    const repo = makeFakeRepo();
    await assert.rejects(
      () =>
        updateOrganisationDisplayName(
          { organisationId: FIXTURE_PROFILE.id, displayName: "X" },
          { organisations: repo }
        ),
      (err: unknown) => err instanceof ValidationError
    );
  });

  it("throws ValidationError for display name longer than 120 chars", async () => {
    const repo = makeFakeRepo();
    await assert.rejects(
      () =>
        updateOrganisationDisplayName(
          { organisationId: FIXTURE_PROFILE.id, displayName: "A".repeat(121) },
          { organisations: repo }
        ),
      (err: unknown) => err instanceof ValidationError
    );
  });

  it("throws ValidationError for display name with control characters", async () => {
    const repo = makeFakeRepo();
    await assert.rejects(
      () =>
        updateOrganisationDisplayName(
          { organisationId: FIXTURE_PROFILE.id, displayName: "Bad\x00Name" },
          { organisations: repo }
        ),
      (err: unknown) => err instanceof ValidationError
    );
  });

  it("throws NotFoundError when repository returns null", async () => {
    const repo = makeFakeRepo({ updateDisplayName: async () => null });
    await assert.rejects(
      () =>
        updateOrganisationDisplayName(
          { organisationId: "00000000-0000-0000-0000-000000000099", displayName: "New" },
          { organisations: repo }
        ),
      (err: unknown) => err instanceof NotFoundError
    );
  });
});
