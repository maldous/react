// ---------------------------------------------------------------------------
// Click-through services usecase (ADR-ACT-0233 / ADR-0072).
//
// The operator's view of the composed Compose GUI services: each service's
// click-through URL, access gating (reusing the SAME decideServiceAccess decision
// the forward-auth gate uses), isolation invariant, and readiness. Credential
// validation + adapter-confirmed readiness come from the composed-provider readiness
// probe (OpenBao-backed); no secret is ever returned. Read-only.
// ---------------------------------------------------------------------------

import type {
  ClickthroughReadiness,
  ClickthroughServiceRow,
  ClickthroughServicesResponse,
  ComposedProviderReadinessRow,
} from "@platform/contracts-admin";
import { CLICKTHROUGH_SERVICES, decideServiceAccess } from "./service-clickthrough.ts";
import { getComposedProviderReadiness } from "./composed-providers.ts";

// Map composed-provider readiness (keyed by provider) onto a click-through service
// where the ids overlap; otherwise readiness is "unknown" (the click-through itself,
// gated by forward-auth + the service's own auth, is the validation).
function readinessFor(
  serviceId: string,
  providers: readonly ComposedProviderReadinessRow[]
): ClickthroughReadiness {
  const row = providers.find((p) => p.provider === serviceId);
  return row ? row.status : "unknown";
}

/** Apex click-through path from a Caddy path prefix ("/kc/*" → "/kc"). */
function apexUrl(apexPath: string | null): string | null {
  if (apexPath == null) return null;
  const trimmed = apexPath.replace(/\/\*$/, "");
  return trimmed === "" ? "/" : trimmed;
}

export async function listClickthroughServices(input: {
  roles: string[];
}): Promise<ClickthroughServicesResponse> {
  // Composed-provider readiness is the adapter-confirmed, OpenBao-credential-validated
  // status (probes live health, never echoes a secret).
  const { providers } = await getComposedProviderReadiness();

  const services: ClickthroughServiceRow[] = CLICKTHROUGH_SERVICES
    // not_exposed services are never reachable — they never appear on the page.
    .filter((s) => s.classification !== "not_exposed")
    .map((s) => ({
      id: s.id,
      resource: s.resource,
      classification: s.classification,
      url: apexUrl(s.apexPath),
      // Same decision path as forward-auth, evaluated for the APEX (global) host.
      accessible: decideServiceAccess({
        roles: input.roles,
        resource: s.resource,
        requestedSlug: null,
        ownSlug: null,
      }).granted,
      readiness: readinessFor(s.id, providers),
      isolationInvariant: s.isolationInvariant,
    }));

  return { services, providers };
}
