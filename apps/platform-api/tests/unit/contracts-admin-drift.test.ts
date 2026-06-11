/**
 * Contract drift guard (ADR-0036/0037).
 *
 * @platform/contracts-admin is intentionally dependency-free, so it re-declares the
 * tenant-role and product-provider literals rather than importing them. This test is
 * the safety net: it imports BOTH sides and fails if the contract literals diverge
 * from their sources of truth — domain-identity (roles) and the BFF auth-providers
 * module (provider ids). Tests may import across layers; the package may not.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { TENANT_ROLES as DOMAIN_ROLES } from "@platform/domain-identity";
import {
  TENANT_ROLES as CONTRACT_ROLES,
  PRODUCT_PROVIDER_IDS as CONTRACT_PROVIDERS,
} from "@platform/contracts-admin";
import { PRODUCT_PROVIDER_IDS as SERVER_PROVIDERS } from "../../src/server/auth-providers.ts";

const sorted = (xs: readonly string[]) => [...xs].sort();

describe("contracts-admin drift", () => {
  it("TENANT_ROLES matches @platform/domain-identity", () => {
    assert.deepEqual(
      sorted(CONTRACT_ROLES),
      sorted(DOMAIN_ROLES),
      "contracts-admin TENANT_ROLES diverged from domain-identity — update one to match the other"
    );
  });

  it("PRODUCT_PROVIDER_IDS matches the BFF auth-providers module", () => {
    assert.deepEqual(
      sorted(CONTRACT_PROVIDERS),
      sorted(SERVER_PROVIDERS),
      "contracts-admin PRODUCT_PROVIDER_IDS diverged from server/auth-providers — update one to match the other"
    );
  });
});
