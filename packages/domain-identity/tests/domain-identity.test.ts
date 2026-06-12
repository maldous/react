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
  validateTenantUsername,
  canTransitionMembershipStatus,
  MEMBERSHIP_STATUSES,
  classifyHostIdentity,
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

  const required = [
    "staging",
    "prod",
    "production",
    "dev",
    "test",
    "admin",
    "api",
    "app",
    "auth",
    "login",
    "account",
    "sso",
    "kc",
    "keycloak",
    "pgadmin",
    "grafana",
    "monitoring",
    "mailpit",
    "minio",
    "sonar",
    "sonarqube",
    "sentry",
    "wiremock",
    "clickhouse",
    "localstack",
    "otel",
    "opentelemetry",
    "static",
    "assets",
    "cdn",
    "support",
    "status",
    "docs",
    "global",
    "platform",
    "root",
    "system",
    "aldous",
  ];
  for (const slug of required) {
    it(`"${slug}" is reserved`, () => {
      assert.ok(isSlugReserved(slug), `Expected "${slug}" to be reserved`);
    });
  }
});

describe("resolvePermissions", () => {
  it("system-admin has core shared permissions", () => {
    const perms = resolvePermissions("system-admin");
    assert.ok(perms.includes("organisation.read"));
    assert.ok(perms.includes("organisation.update"));
    assert.ok(perms.includes("platform.admin.access"));
    assert.ok(perms.includes("audit.read"));
  });

  it("tenant-admin has core shared permissions", () => {
    const perms = resolvePermissions("tenant-admin");
    assert.ok(perms.includes("organisation.update"));
    assert.ok(perms.includes("tenant.admin.access"));
  });

  it("manager can manage members but not org settings", () => {
    const perms = resolvePermissions("manager");
    assert.ok(perms.includes("member.invite"));
    assert.ok(perms.includes("member.update_role"));
    assert.ok(!perms.includes("organisation.update"));
    assert.ok(!perms.includes("platform.admin.access"));
    assert.ok(!perms.includes("tenant.admin.access"));
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
    const resolved = resolvePermissions("tenant-admin");
    assert.ok(resolved.includes("organisation.read"));
    assert.ok(resolved.includes("organisation.update"));
    assert.ok(resolved.includes("tenant.admin.access"));
  });
});

describe("resolvePermissions — split admin permissions", () => {
  it("system-admin has platform.admin.access and not tenant.admin.access", () => {
    const perms = resolvePermissions("system-admin");
    assert.ok(
      perms.includes("platform.admin.access"),
      "system-admin must have platform.admin.access"
    );
    assert.ok(
      !perms.includes("tenant.admin.access"),
      "system-admin must NOT have tenant.admin.access"
    );
    assert.ok(!perms.includes("admin.access"), "legacy admin.access must not appear");
  });

  it("tenant-admin has tenant.admin.access and not platform.admin.access", () => {
    const perms = resolvePermissions("tenant-admin");
    assert.ok(perms.includes("tenant.admin.access"), "tenant-admin must have tenant.admin.access");
    assert.ok(
      !perms.includes("platform.admin.access"),
      "tenant-admin must NOT have platform.admin.access"
    );
    assert.ok(!perms.includes("admin.access"), "legacy admin.access must not appear");
  });

  it("system-admin has platform.tenants.create", () => {
    assert.ok(resolvePermissions("system-admin").includes("platform.tenants.create"));
  });

  it("tenant-admin does not have platform.tenants.create", () => {
    assert.ok(!resolvePermissions("tenant-admin").includes("platform.tenants.create"));
  });

  it("tenant-admin has tenant.auth.settings.read and tenant.auth.settings.write", () => {
    const perms = resolvePermissions("tenant-admin");
    assert.ok(perms.includes("tenant.auth.settings.read"));
    assert.ok(perms.includes("tenant.auth.settings.write"));
  });

  it("system-admin does not have tenant.auth.settings.read", () => {
    assert.ok(!resolvePermissions("system-admin").includes("tenant.auth.settings.read"));
  });

  it("tenant-admin does not have platform.clickthrough.pgadmin", () => {
    assert.ok(!resolvePermissions("tenant-admin").includes("platform.clickthrough.pgadmin"));
  });

  it("system-admin has platform.clickthrough.pgadmin", () => {
    assert.ok(resolvePermissions("system-admin").includes("platform.clickthrough.pgadmin"));
  });
});

describe("validateTenantUsername (ADR-ACT-0206)", () => {
  it("accepts valid handles", () => {
    for (const u of ["jane", "jane.doe", "j_doe-1", "a1b"]) {
      assert.deepEqual(validateTenantUsername(u), [], `expected ${u} to be valid`);
    }
  });
  it("rejects empty / too short / too long", () => {
    assert.ok(validateTenantUsername("").length > 0);
    assert.ok(validateTenantUsername("ab").length > 0);
    assert.ok(validateTenantUsername("a".repeat(33)).length > 0);
  });
  it("rejects illegal characters and edge separators", () => {
    assert.ok(validateTenantUsername("has space").length > 0);
    assert.ok(validateTenantUsername(".leading").length > 0);
    assert.ok(validateTenantUsername("trailing-").length > 0);
    assert.ok(validateTenantUsername("white@space").length > 0);
  });
});

describe("canTransitionMembershipStatus (ADR-ACT-0206)", () => {
  it("allows enable/disable and invited→active", () => {
    assert.equal(canTransitionMembershipStatus("active", "disabled"), true);
    assert.equal(canTransitionMembershipStatus("disabled", "active"), true);
    assert.equal(canTransitionMembershipStatus("invited", "active"), true);
  });
  it("allows idempotent no-ops", () => {
    for (const s of MEMBERSHIP_STATUSES) {
      assert.equal(canTransitionMembershipStatus(s, s), true);
    }
  });
  it("rejects illegal transitions (active/disabled → invited)", () => {
    assert.equal(canTransitionMembershipStatus("active", "invited"), false);
    assert.equal(canTransitionMembershipStatus("disabled", "invited"), false);
  });
});

describe("classifyHostIdentity (ADR-ACT-0231)", () => {
  const apex = "aldous.info";

  it("classifies the apex itself", () => {
    assert.deepEqual(classifyHostIdentity("aldous.info", apex), {
      kind: "apex",
      hostname: "aldous.info",
      port: null,
      slug: null,
    });
  });

  it("classifies the apex with a port (port stripped, retained)", () => {
    const id = classifyHostIdentity("aldous.info:8081", apex);
    assert.equal(id.kind, "apex");
    assert.equal(id.port, "8081");
  });

  it("classifies a valid tenant slug subdomain", () => {
    const id = classifyHostIdentity("acme-corp.aldous.info", apex);
    assert.equal(id.kind, "tenant_slug");
    assert.equal(id.slug, "acme-corp");
  });

  it("classifies a tenant slug with port", () => {
    const id = classifyHostIdentity("acme.test.localhost:8081", "test.localhost");
    assert.equal(id.kind, "tenant_slug");
    assert.equal(id.slug, "acme");
    assert.equal(id.port, "8081");
  });

  it("classifies reserved subdomains", () => {
    for (const reserved of ["kc", "admin", "api", "staging", "pgadmin", "aldous"]) {
      assert.equal(
        classifyHostIdentity(`${reserved}.aldous.info`, apex).kind,
        "reserved_subdomain",
        `${reserved} must classify reserved`
      );
    }
  });

  it("classifies dotted (multi-level) subdomains as invalid", () => {
    assert.equal(classifyHostIdentity("a.b.aldous.info", apex).kind, "invalid_subdomain");
  });

  it("classifies hosts outside the apex zone as custom domain candidates", () => {
    assert.equal(classifyHostIdentity("app.mycorp.example", apex).kind, "custom_domain_candidate");
    assert.equal(classifyHostIdentity("localhost", apex).kind, "custom_domain_candidate");
    // suffix-similarity does not leak into the apex zone
    assert.equal(classifyHostIdentity("evilaldous.info", apex).kind, "custom_domain_candidate");
  });

  it("lowercases hostnames", () => {
    const id = classifyHostIdentity("App.MyCorp.Example", apex);
    assert.equal(id.hostname, "app.mycorp.example");
  });

  it("classifies malformed hosts", () => {
    for (const bad of [
      "",
      "  ",
      "bad host",
      "-leading.aldous.info",
      "x..y",
      "a:b:c",
      "host:port",
      "a".repeat(254),
    ]) {
      assert.equal(
        classifyHostIdentity(bad, apex).kind,
        "malformed",
        `"${bad}" must classify malformed`
      );
    }
  });

  it("never returns a slug for non-tenant kinds", () => {
    for (const host of ["aldous.info", "kc.aldous.info", "a.b.aldous.info", "other.example", ""]) {
      assert.equal(classifyHostIdentity(host, apex).slug, null);
    }
  });

  it("staging apex: production subdomains are outside the staging zone", () => {
    assert.equal(
      classifyHostIdentity("tenant1.aldous.info", "staging.aldous.info").kind,
      "custom_domain_candidate"
    );
    assert.equal(
      classifyHostIdentity("tenant1.staging.aldous.info", "staging.aldous.info").kind,
      "tenant_slug"
    );
  });
});
