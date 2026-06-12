/**
 * TenantDomainRegistryPort — durable custom-domain lifecycle state (ADR-ACT-0232).
 *
 * Backed by public.tenant_domains (migration 021). The registry is the single
 * source of truth for a domain's ownership / auth-client / routing / TLS /
 * canonical state. Status upgrades are honest by construction:
 *   - ownership only changes via the DNS-TXT challenge flow
 *   - auth_client only changes after the Keycloak client mutation succeeded
 *   - routing/tls only change from a live probe (never inferred)
 *   - canonical only via the guarded canonical operations
 */

import type {
  TenantDomainAuthClientStatus,
  TenantDomainRedirectPolicy,
  TenantDomainRoutingStatus,
  TenantDomainSource,
  TenantDomainTlsStatus,
} from "@platform/contracts-admin";

export type DomainOwnershipStatus = "pending_dns" | "dns_mismatch" | "verified";

export interface TenantDomainRecord {
  organisationId: string;
  domain: string;
  source: TenantDomainSource;
  ownershipStatus: DomainOwnershipStatus;
  authClientStatus: TenantDomainAuthClientStatus;
  routingStatus: TenantDomainRoutingStatus;
  tlsStatus: TenantDomainTlsStatus;
  canonical: boolean;
  redirectPolicy: TenantDomainRedirectPolicy;
  createdAt: Date | null;
  verifiedAt: Date | null;
  authClientActivatedAt: Date | null;
  routingLocalProvenAt: Date | null;
  routingPublicProvenAt: Date | null;
  tlsLocalProvenAt: Date | null;
  tlsPublicProvenAt: Date | null;
  canonicalAt: Date | null;
  disabledAt: Date | null;
}

export interface TenantDomainRegistryPort {
  /** Enabled (not disabled) domains for the tenant, ordered by domain. */
  listDomains(organisationId: string): Promise<TenantDomainRecord[]>;
  /** A single enabled domain row for the tenant, or null. */
  getDomain(organisationId: string, domain: string): Promise<TenantDomainRecord | null>;
  /** Ensure an enabled row exists (pending ownership). Never downgrades an
   * existing row; never steals a domain enabled for another tenant. */
  ensurePending(organisationId: string, domain: string): Promise<void>;
  /** Record the DNS-TXT verification outcome. */
  markOwnership(
    organisationId: string,
    domain: string,
    status: DomainOwnershipStatus
  ): Promise<void>;
  /** Record that the Keycloak client mutation succeeded. */
  markAuthClientActive(organisationId: string, domain: string): Promise<void>;
  /** Auth-client deactivation. Also clears canonical and resets routing to
   * routing_unknown — a domain that no longer serves auth cannot retain a
   * routing claim that was proven while active. */
  markAuthClientInactive(organisationId: string, domain: string): Promise<void>;
  /** Record a successful LOCAL routing probe (never public). */
  markRoutingLocalActive(organisationId: string, domain: string): Promise<void>;
  /** Mark canonical (caller must have applied the canonical guards). Replaces
   * any previous canonical domain for the organisation atomically. */
  setCanonical(organisationId: string, domain: string): Promise<void>;
  unsetCanonical(organisationId: string, domain: string): Promise<void>;
  /** Soft-disable: the domain stops resolving immediately; history retained. */
  disable(organisationId: string, domain: string): Promise<void>;
}
