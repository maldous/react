/**
 * CaddyLocalRoutingProbe — LocalRoutingProbePort over the LOCAL Caddy (web
 * profile). Sends a bounded GET to the proxy with the probed domain as the
 * Host header and checks the public `/api/host-identity` endpoint reflects the
 * EXPECTED tenant slug. The connection target is the local proxy base URL —
 * no public DNS resolution is involved, so this is local-only by construction.
 *
 * Implemented with node:http (NOT fetch): undici silently ignores a `host`
 * header override, which would turn the probe into an apex request and make a
 * negative result look like a routing failure (or worse, a false positive on
 * the apex). http.request honours an explicit Host header.
 *
 * Probe base resolution:
 *   DOMAIN_ROUTING_PROBE_BASE_URL  (web profile container: http://react-app)
 *   default http://localhost:8081  (host-run BFF against `make compose-up-web ENV=test`)
 */

import http from "node:http";
import type {
  LocalRoutingProbePort,
  LocalRoutingProbeResult,
} from "../ports/domain-routing-probe.ts";

const PROBE_TIMEOUT_MS = 4000;

interface HostIdentityBody {
  tenant?: { slug?: string; hostSource?: string } | null;
}

function getWithHostOverride(
  baseUrl: string,
  hostHeader: string
): Promise<HostIdentityBody | null> {
  return new Promise((resolve) => {
    const base = new URL(baseUrl);
    const req = http.request(
      {
        host: base.hostname,
        port: base.port || 80,
        path: "/api/host-identity",
        method: "GET",
        headers: { Host: hostHeader, Accept: "application/json" },
        setHost: false, // do NOT overwrite the explicit Host header
        timeout: PROBE_TIMEOUT_MS,
      },
      (res) => {
        let data = "";
        res.on("data", (chunk: Buffer) => {
          data += chunk.toString();
        });
        res.on("end", () => {
          if ((res.statusCode ?? 0) >= 400) return resolve({});
          try {
            resolve(JSON.parse(data) as HostIdentityBody);
          } catch {
            resolve({});
          }
        });
      }
    );
    req.on("timeout", () => {
      req.destroy();
      resolve(null);
    });
    req.on("error", () => resolve(null));
    req.end();
  });
}

export class CaddyLocalRoutingProbe implements LocalRoutingProbePort {
  private readonly baseUrl: string;

  constructor(baseUrl?: string) {
    this.baseUrl =
      baseUrl ?? process.env["DOMAIN_ROUTING_PROBE_BASE_URL"] ?? "http://localhost:8081";
  }

  async probe(domain: string, expectedSlug: string): Promise<LocalRoutingProbeResult> {
    const body = await getWithHostOverride(this.baseUrl, domain);
    if (body === null) return { reachable: false, tenantContextMatched: false };
    return {
      reachable: true,
      tenantContextMatched:
        body.tenant?.slug === expectedSlug && body.tenant?.hostSource === "custom_domain",
    };
  }
}
