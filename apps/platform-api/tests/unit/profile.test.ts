import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { type AuditEvent, type AuditEventPort } from "@platform/audit-events";
import { getMyProfile, updateMyProfile } from "../../src/usecases/profile.ts";
import type {
  ProfileRecord,
  ProfileRepository,
  UpsertProfileInput,
} from "../../src/ports/profile-repository.ts";

const ORG = "11111111-1111-1111-1111-111111111111";
const USER = "user-1";
const ACTOR = { actorId: USER, actorRoles: ["tenant-admin"] };

function fakeProfiles(): ProfileRepository & { _rows: Map<string, ProfileRecord> } {
  const rows = new Map<string, ProfileRecord>();
  return {
    _rows: rows,
    async getForUser(org, userId) {
      return rows.get(`${org}|${userId}`) ?? null;
    },
    async upsertForUser(i: UpsertProfileInput) {
      const rec = { displayName: i.displayName, locale: i.locale, timezone: i.timezone };
      rows.set(`${i.organisationId}|${i.userId}`, rec);
      return rec;
    },
  };
}

function capturingAudit(): { port: AuditEventPort; events: AuditEvent[] } {
  const events: AuditEvent[] = [];
  return {
    events,
    port: {
      emit: async (e) => {
        events.push(e);
      },
      query: async () => events,
    },
  };
}

describe("profile self-service usecase", () => {
  it("returns defaults when no profile is saved", async () => {
    const deps = { profiles: fakeProfiles(), audit: capturingAudit().port };
    const p = await getMyProfile(ORG, USER, deps);
    assert.equal(p.displayName, "");
    assert.equal(p.locale, "en-GB");
  });

  it("rejects an empty display name", async () => {
    const deps = { profiles: fakeProfiles(), audit: capturingAudit().port };
    await assert.rejects(
      updateMyProfile(
        {
          organisationId: ORG,
          userId: USER,
          displayName: "  ",
          locale: "en-GB",
          timezone: "UTC",
          actor: ACTOR,
        },
        deps
      )
    );
  });

  it("updates the caller's own profile and audits it", async () => {
    const profiles = fakeProfiles();
    const audit = capturingAudit();
    const deps = { profiles, audit: audit.port };
    const p = await updateMyProfile(
      {
        organisationId: ORG,
        userId: USER,
        displayName: "Ada",
        locale: "en-GB",
        timezone: "Europe/London",
        actor: ACTOR,
      },
      deps
    );
    assert.equal(p.displayName, "Ada");
    assert.equal(audit.events[0]?.resource, "user_profile");
    assert.equal(audit.events[0]?.resourceId, USER);
    // round-trips for the same user
    assert.equal((await getMyProfile(ORG, USER, deps)).displayName, "Ada");
    // a different user's profile is independent (own-profile-only by userId key)
    assert.equal((await getMyProfile(ORG, "user-2", deps)).displayName, "");
  });
});
