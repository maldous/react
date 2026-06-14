/**
 * Service clickthrough policy tests (ADR-ACT-0233).
 *
 * 1. decideServiceAccess — pure decision matrix for every classification.
 * 2. Caddyfile reconciliation — parses docker/caddy/Caddyfile and asserts the
 *    forward-auth resources routed per vhost block exactly match the policy
 *    module. This is the drift gate that caught the original findings
 *    (tenant Mailpit routed without isolation; Sentry tenant grant never
 *    routed) and prevents them from recurring.
 * 3. Permission vocabulary — role bundles only carry clickthrough permissions
 *    for services the policy actually exposes to that role.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  CLICKTHROUGH_SERVICES,
  SYSTEM_ADMIN_RESOURCES,
  TENANT_ADMIN_RESOURCES,
  decideServiceAccess,
} from "../../src/usecases/service-clickthrough.ts";
import { apexUrl } from "../../src/usecases/clickthrough-services.ts";
import { resolvePermissions } from "@platform/domain-identity";

// ---------------------------------------------------------------------------
// 0. apexUrl — the click-through URL served to the admin page MUST keep the
//    trailing slash. Caddy routes are `handle /svc/*`, which match `/svc/` but
//    NOT bare `/svc`; a bare path falls through to the SPA and renders
//    "Page not found". Regression guard for ADR-ACT-0284 (the bug stripped the
//    slash along with the `*`, breaking every clickthrough link).
// ---------------------------------------------------------------------------

describe("apexUrl trailing slash (ADR-ACT-0284)", () => {
  it("keeps the trailing slash when stripping the wildcard", () => {
    assert.equal(apexUrl("/mailpit/*"), "/mailpit/");
    assert.equal(apexUrl("/grafana/*"), "/grafana/");
    assert.equal(apexUrl("/kc/*"), "/kc/");
  });
  it("never returns a bare tool path (would fall through to the SPA)", () => {
    for (const s of CLICKTHROUGH_SERVICES) {
      const url = apexUrl(s.apexPath);
      if (url && url !== "/") assert.ok(url.endsWith("/"), `${s.id} url must end with /: ${url}`);
    }
  });
  it("maps null apexPath to null and a lone wildcard to root", () => {
    assert.equal(apexUrl(null), null);
    assert.equal(apexUrl("/*"), "/");
  });
});

// ---------------------------------------------------------------------------
// 1. Decision matrix
// ---------------------------------------------------------------------------

describe("decideServiceAccess (ADR-ACT-0233)", () => {
  it("system-admin is granted every exposed service, from any host", () => {
    for (const s of CLICKTHROUGH_SERVICES.filter((s) => s.classification !== "not_exposed")) {
      for (const requestedSlug of [null, "acme"]) {
        const d = decideServiceAccess({
          roles: ["system-admin"],
          resource: s.resource,
          requestedSlug,
          ownSlug: null,
        });
        assert.ok(d.granted, `${s.resource} (slug=${requestedSlug})`);
      }
    }
  });

  it("NOT_EXPOSED services are denied even to system-admin", () => {
    const d = decideServiceAccess({
      roles: ["system-admin"],
      resource: "admin:wiremock",
      requestedSlug: null,
      ownSlug: null,
    });
    assert.deepEqual(d, { granted: false, reason: "not_exposed" });
  });

  it("unknown resources are denied", () => {
    assert.equal(
      decideServiceAccess({
        roles: ["system-admin"],
        resource: "admin:nonexistent",
        requestedSlug: null,
        ownSlug: null,
      }).reason,
      "unknown_resource"
    );
  });

  it("tenant-admin gets ONLY tenant_scoped_safe services, on own slug only", () => {
    for (const s of CLICKTHROUGH_SERVICES) {
      const own = decideServiceAccess({
        roles: ["tenant-admin"],
        resource: s.resource,
        requestedSlug: "acme",
        ownSlug: "acme",
      });
      assert.equal(
        own.granted,
        s.classification === "tenant_scoped_safe",
        `${s.resource} on own slug`
      );
      for (const [requestedSlug, ownSlug, label] of [
        ["other", "acme", "cross-tenant"],
        [null, "acme", "apex host"],
        ["acme", null, "ownership lookup failed"],
      ] as const) {
        assert.ok(
          !decideServiceAccess({
            roles: ["tenant-admin"],
            resource: s.resource,
            requestedSlug,
            ownSlug,
          }).granted,
          `${s.resource} must deny tenant-admin: ${label}`
        );
      }
    }
  });

  it("mailpit and sentry are GLOBAL_ONLY (ADR-ACT-0230 findings closed)", () => {
    for (const resource of ["admin:mailpit", "admin:sentry"]) {
      assert.ok(!TENANT_ADMIN_RESOURCES.has(resource), `${resource} must not be tenant-safe`);
      assert.equal(
        decideServiceAccess({
          roles: ["tenant-admin"],
          resource,
          requestedSlug: "acme",
          ownSlug: "acme",
        }).reason,
        "global_only_service"
      );
    }
  });

  it("non-admin roles are denied everything", () => {
    for (const role of ["manager", "member", "viewer"]) {
      assert.ok(
        !decideServiceAccess({
          roles: [role],
          resource: "admin:keycloak",
          requestedSlug: "acme",
          ownSlug: "acme",
        }).granted
      );
    }
  });

  it("derived sets are consistent with the policy table", () => {
    assert.ok(SYSTEM_ADMIN_RESOURCES.has("admin:pgadmin"));
    assert.ok(!SYSTEM_ADMIN_RESOURCES.has("admin:wiremock"));
    assert.deepEqual([...TENANT_ADMIN_RESOURCES], ["admin:keycloak"]);
  });
});

// ---------------------------------------------------------------------------
// 2. Caddyfile reconciliation
// ---------------------------------------------------------------------------

interface CaddyBlock {
  address: string;
  resources: Set<string>;
}

function parseCaddyfileBlocks(source: string): CaddyBlock[] {
  const blocks: CaddyBlock[] = [];
  let current: CaddyBlock | null = null;
  let depth = 0;
  for (const raw of source.split("\n")) {
    const line = raw.trim();
    if (depth === 0 && line.endsWith("{") && !line.startsWith("#")) {
      current = { address: line.slice(0, -1).trim(), resources: new Set() };
      depth = 1;
      continue;
    }
    if (!current) continue;
    depth += (line.match(/\{/g) ?? []).length - (line.match(/\}/g) ?? []).length;
    const m = line.match(/^import\s+forward_auth_check\s+(\S+)\s+\S+$/);
    if (m?.[1]) current.resources.add(m[1]);
    if (depth <= 0) {
      blocks.push(current);
      current = null;
      depth = 0;
    }
  }
  return blocks;
}

describe("Caddyfile ↔ clickthrough policy reconciliation (ADR-ACT-0233)", () => {
  const caddyfile = fs.readFileSync(path.join(process.cwd(), "docker/caddy/Caddyfile"), "utf8");
  const blocks = parseCaddyfileBlocks(caddyfile);
  const apexBlock = blocks.find((b) => b.address.split(/\s+/).includes("http://aldous.info"));
  const tenantBlock = blocks.find((b) => b.address.split(/\s+/).includes("http://*.aldous.info"));
  const catchAllBlock = blocks.find((b) => b.address === "http://");

  it("finds the apex, tenant-wildcard, and custom-domain catch-all vhost blocks", () => {
    assert.ok(apexBlock, "apex block");
    assert.ok(tenantBlock, "tenant wildcard block");
    assert.ok(catchAllBlock, "catch-all block (ADR-ACT-0232)");
  });

  it("apex block routes exactly the exposed services that declare an apex path", () => {
    const expected = new Set(
      CLICKTHROUGH_SERVICES.filter(
        (s) => s.classification !== "not_exposed" && s.apexPath !== null
      ).map((s) => s.resource)
    );
    assert.deepEqual(apexBlock!.resources, expected);
  });

  it("tenant block routes exactly the tenant_scoped_safe services that declare a tenant path", () => {
    const expected = new Set(
      CLICKTHROUGH_SERVICES.filter(
        (s) => s.classification === "tenant_scoped_safe" && s.tenantPath !== null
      ).map((s) => s.resource)
    );
    assert.deepEqual(tenantBlock!.resources, expected);
  });

  it("custom-domain catch-all exposes NO tool clickthroughs", () => {
    assert.deepEqual([...catchAllBlock!.resources], []);
  });

  it("NOT_EXPOSED services appear in no block", () => {
    for (const s of CLICKTHROUGH_SERVICES.filter((s) => s.classification === "not_exposed")) {
      for (const b of blocks) {
        assert.ok(!b.resources.has(s.resource), `${s.resource} must not be routed (${b.address})`);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Permission vocabulary alignment
// ---------------------------------------------------------------------------

describe("clickthrough permission vocabulary ↔ policy (ADR-ACT-0233)", () => {
  it("tenant-admin carries tenant.clickthrough.* ONLY for tenant_scoped_safe services", () => {
    const tenantPerms = resolvePermissions("tenant-admin").filter((p) =>
      p.startsWith("tenant.clickthrough.")
    );
    const safeIds = CLICKTHROUGH_SERVICES.filter(
      (s) => s.classification === "tenant_scoped_safe"
    ).map((s) => `tenant.clickthrough.${s.id}`);
    assert.deepEqual(tenantPerms.sort(), safeIds.sort());
  });

  it("system-admin carries platform.clickthrough.* ONLY for exposed services", () => {
    const sysPerms = resolvePermissions("system-admin").filter((p) =>
      p.startsWith("platform.clickthrough.")
    );
    const exposedIds = new Set(
      CLICKTHROUGH_SERVICES.filter((s) => s.classification !== "not_exposed").map((s) => s.id)
    );
    for (const p of sysPerms) {
      const id = p.replace("platform.clickthrough.", "");
      assert.ok(exposedIds.has(id), `${p} grants a clickthrough the policy does not expose`);
    }
    assert.ok(
      !sysPerms.includes("platform.clickthrough.wiremock"),
      "wiremock permission must not exist (NOT_EXPOSED)"
    );
  });
});
