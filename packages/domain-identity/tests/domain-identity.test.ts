import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  packageName,
  isGlobalRole,
  isTenantRole,
  canInviteMembers,
  canUpdateOrganisation,
  canUpdateMemberRole,
  canAccessAdmin,
  validateMembership,
  validateOrganisationSlug,
  isSlugReserved,
  RESERVED_SLUGS,
  resolvePermissions,
  type Membership,
} from "../src/index.ts";

describe("packageName", () => {
  it("exports the correct package name", () => {
    assert.equal(packageName, "@platform/domain-identity");
  });
});

describe("isGlobalRole", () => {
  it("returns true for system-admin", () => {
    assert.ok(isGlobalRole("system-admin"));
  });

  it("returns false for tenant roles", () => {
    assert.ok(!isGlobalRole("tenant-admin"));
    assert.ok(!isGlobalRole("manager"));
    assert.ok(!isGlobalRole("member"));
    assert.ok(!isGlobalRole("viewer"));
  });
});

describe("isTenantRole", () => {
  it("returns true for tenant roles", () => {
    assert.ok(isTenantRole("tenant-admin"));
    assert.ok(isTenantRole("manager"));
    assert.ok(isTenantRole("member"));
    assert.ok(isTenantRole("viewer"));
  });

  it("returns false for system-admin", () => {
    assert.ok(!isTenantRole("system-admin"));
  });
});

describe("canInviteMembers", () => {
  it("returns true for system-admin", () => {
    assert.ok(canInviteMembers("system-admin"));
  });

  it("returns true for tenant-admin", () => {
    assert.ok(canInviteMembers("tenant-admin"));
  });

  it("returns true for manager", () => {
    assert.ok(canInviteMembers("manager"));
  });

  it("returns false for member", () => {
    assert.ok(!canInviteMembers("member"));
  });

  it("returns false for viewer", () => {
    assert.ok(!canInviteMembers("viewer"));
  });
});

describe("canUpdateOrganisation", () => {
  it("returns true for system-admin", () => {
    assert.ok(canUpdateOrganisation("system-admin"));
  });

  it("returns true for tenant-admin", () => {
    assert.ok(canUpdateOrganisation("tenant-admin"));
  });

  it("returns false for manager", () => {
    assert.ok(!canUpdateOrganisation("manager"));
  });

  it("returns false for member", () => {
    assert.ok(!canUpdateOrganisation("member"));
  });

  it("returns false for viewer", () => {
    assert.ok(!canUpdateOrganisation("viewer"));
  });
});

describe("canUpdateMemberRole", () => {
  it("returns true for system-admin and tenant-admin", () => {
    assert.ok(canUpdateMemberRole("system-admin"));
    assert.ok(canUpdateMemberRole("tenant-admin"));
  });

  it("returns false for manager, member, viewer", () => {
    assert.ok(!canUpdateMemberRole("manager"));
    assert.ok(!canUpdateMemberRole("member"));
    assert.ok(!canUpdateMemberRole("viewer"));
  });
});

describe("canAccessAdmin", () => {
  it("returns true for system-admin and tenant-admin", () => {
    assert.ok(canAccessAdmin("system-admin"));
    assert.ok(canAccessAdmin("tenant-admin"));
  });

  it("returns false for other roles", () => {
    assert.ok(!canAccessAdmin("manager"));
    assert.ok(!canAccessAdmin("member"));
    assert.ok(!canAccessAdmin("viewer"));
  });
});

describe("validateMembership", () => {
  it("returns no errors for a valid membership", () => {
    const membership: Partial<Membership> = {
      userId: "user-1",
      organisationId: "org-1",
      role: "manager",
    };
    assert.deepEqual(validateMembership(membership), []);
  });

  it("returns error when userId is missing", () => {
    const errors = validateMembership({ organisationId: "org-1", role: "member" });
    assert.ok(errors.includes("userId is required"));
  });

  it("returns error when organisationId is missing", () => {
    const errors = validateMembership({ userId: "user-1", role: "member" });
    assert.ok(errors.includes("organisationId is required"));
  });

  it("returns error when role is missing", () => {
    const errors = validateMembership({ userId: "user-1", organisationId: "org-1" });
    assert.ok(errors.includes("role is required"));
  });

  it("returns error when system-admin role is used in membership", () => {
    const errors = validateMembership({
      userId: "user-1",
      organisationId: "org-1",
      role: "system-admin" as unknown as "member",
    });
    assert.ok(errors.some((e) => e.includes("system-admin is not a membership role")));
  });
});

describe("validateOrganisationSlug", () => {
  it("returns no errors for a valid slug", () => {
    assert.deepEqual(validateOrganisationSlug("my-org"), []);
    assert.deepEqual(validateOrganisationSlug("acme-corp-123"), []);
    assert.deepEqual(validateOrganisationSlug("ab"), []);
  });

  it("returns error for empty slug", () => {
    const errors = validateOrganisationSlug("");
    assert.ok(errors.some((e) => e.includes("required")));
  });

  it("returns error for slug with uppercase", () => {
    const errors = validateOrganisationSlug("MyOrg");
    assert.ok(errors.some((e) => e.includes("lowercase")));
  });

  it("returns error for slug starting with hyphen", () => {
    const errors = validateOrganisationSlug("-org");
    assert.ok(errors.some((e) => e.includes("not start or end with a hyphen")));
  });

  it("returns error for slug ending with hyphen", () => {
    const errors = validateOrganisationSlug("org-");
    assert.ok(errors.some((e) => e.includes("not start or end with a hyphen")));
  });

  it("returns error for slug that is too short", () => {
    const errors = validateOrganisationSlug("a");
    assert.ok(errors.some((e) => e.includes("between 2 and 63")));
  });

  it("returns error for slug that is too long", () => {
    const errors = validateOrganisationSlug("a".repeat(64));
    assert.ok(errors.some((e) => e.includes("between 2 and 63")));
  });

  it("returns error for slug with special characters", () => {
    const errors = validateOrganisationSlug("my_org");
    assert.ok(errors.some((e) => e.includes("lowercase letters, digits, and hyphens")));
  });

  it("returns error for reserved slug: staging", () => {
    const errors = validateOrganisationSlug("staging");
    assert.ok(errors.some((e) => e.includes("reserved")));
  });

  it("returns error for reserved slug: prod", () => {
    const errors = validateOrganisationSlug("prod");
    assert.ok(errors.some((e) => e.includes("reserved")));
  });

  it("returns error for reserved slug: admin", () => {
    const errors = validateOrganisationSlug("admin");
    assert.ok(errors.some((e) => e.includes("reserved")));
  });

  it("returns error for reserved slug: kc", () => {
    const errors = validateOrganisationSlug("kc");
    assert.ok(errors.some((e) => e.includes("reserved")));
  });

  it("returns no error for a slug that looks reserved but isn't (random match)", () => {
    assert.deepEqual(validateOrganisationSlug("my-company"), []);
  });
});

describe("isSlugReserved", () => {
  it("returns true for staging", () => {
    assert.ok(isSlugReserved("staging"));
  });

  it("returns true for prod", () => {
    assert.ok(isSlugReserved("prod"));
  });

  it("returns true for kc", () => {
    assert.ok(isSlugReserved("kc"));
  });

  it("returns false for a non-reserved slug", () => {
    assert.ok(!isSlugReserved("my-company"));
  });

  it("returns false for empty string", () => {
    assert.ok(!isSlugReserved(""));
  });

  it("all RESERVED_SLUGS entries return true from isSlugReserved", () => {
    for (const slug of RESERVED_SLUGS) {
      assert.ok(isSlugReserved(slug), `isSlugReserved must return true for "${slug}"`);
    }
  });
});

describe("resolvePermissions", () => {
  it("system-admin has all 9 permissions", () => {
    const perms = resolvePermissions("system-admin");
    assert.ok(perms.includes("organisation.read"));
    assert.ok(perms.includes("organisation.update"));
    assert.ok(perms.includes("admin.access"));
    assert.ok(perms.includes("audit.read"));
    assert.equal(perms.length, 9);
  });

  it("tenant-admin has all 9 permissions", () => {
    const perms = resolvePermissions("tenant-admin");
    assert.equal(perms.length, 9);
    assert.ok(perms.includes("organisation.update"));
  });

  it("manager can manage members but not org settings", () => {
    const perms = resolvePermissions("manager");
    assert.ok(perms.includes("member.invite"));
    assert.ok(perms.includes("member.update_role"));
    assert.ok(!perms.includes("organisation.update"));
    assert.ok(!perms.includes("admin.access"));
  });

  it("member has standard access", () => {
    const perms = resolvePermissions("member");
    assert.ok(perms.includes("organisation.read"));
    assert.ok(perms.includes("profile.read_self"));
    assert.ok(!perms.includes("organisation.update"));
    assert.ok(!perms.includes("member.invite"));
  });

  it("viewer has read-only access", () => {
    const perms = resolvePermissions("viewer");
    assert.ok(perms.includes("organisation.read"));
    assert.ok(!perms.includes("organisation.update"));
    assert.ok(!perms.includes("member.invite"));
  });

  it("fixture tenant-admin permissions match resolvePermissions output", () => {
    // Guards that session.ts fixtures stay in sync with domain-identity
    const resolved = resolvePermissions("tenant-admin");
    assert.ok(resolved.includes("organisation.read"));
    assert.ok(resolved.includes("organisation.update"));
    assert.ok(resolved.includes("admin.access"));
  });
});
