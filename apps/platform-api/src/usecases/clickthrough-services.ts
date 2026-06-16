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

/**
 * Apex click-through URL from a Caddy path prefix ("/kc/*" → "/kc/").
 *
 * The TRAILING SLASH is significant and MUST be kept: the Caddy tool routes are
 * `handle /kc/*` etc., which match `/kc/` and `/kc/...` but NOT bare `/kc` —
 * a bare path falls through to the SPA catch-all and renders "Page not found"
 * (ADR-ACT-0284). Strip only the `*` wildcard, never the slash before it.
 */
export function apexUrl(apexPath: string | null): string | null {
  if (apexPath == null) return null;
  const trimmed = apexPath.replace(/\*$/, "");
  return trimmed === "" ? "/" : trimmed;
}

/**
 * The click-through URL surfaced to an operator for a service, given the running
 * environment. Three rules over the raw apex route:
 *   - a `devOnly` service is LOCKED (null) in production — it is not deployed there,
 *     so the apex route 502s (the LocalStack "Bad Gateway" finding);
 *   - an explicit `landingPath` wins when the tool's UI is at a subpath, not the apex
 *     root (the ClickHouse "/play" finding — bare /clickhouse/ answers "Ok.");
 *   - otherwise the apex URL (with its significant trailing slash) is used.
 */
export function clickthroughUrlFor(
  service: { apexPath: string | null; landingPath?: string; devOnly?: boolean },
  environment: string
): string | null {
  if (service.devOnly && /^prod(uction)?$/i.test(environment)) return null;
  if (service.landingPath) return service.landingPath;
  return apexUrl(service.apexPath);
}

export async function listClickthroughServices(input: {
  roles: string[];
}): Promise<ClickthroughServicesResponse> {
  // Composed-provider readiness is the adapter-confirmed, OpenBao-credential-validated
  // status (probes live health, never echoes a secret).
  const { providers } = await getComposedProviderReadiness();

  // Running environment governs whether a dev/mock-only service is linked (ADR-0056).
  const environment = process.env["PLATFORM_ENV"] ?? process.env["NODE_ENV"] ?? "development";

  const services: ClickthroughServiceRow[] = CLICKTHROUGH_SERVICES
    // not_exposed services are never reachable — they never appear on the page.
    .filter((s) => s.classification !== "not_exposed")
    .map((s) => ({
      id: s.id,
      resource: s.resource,
      classification: s.classification,
      url: clickthroughUrlFor(s, environment),
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
