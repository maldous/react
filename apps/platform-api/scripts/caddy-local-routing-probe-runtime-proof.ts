/**
 * Provider-ID proof entrypoint for the Caddy local routing probe.
 *
 * The substantive proof lives in tenant-domains-routing-runtime-proof.ts and exercises
 * local Caddy host routing to the correct tenant context, custom-domain catch-all routing,
 * unregistered host rejection, and honest TLS/public-routing deferral.
 */

import "./tenant-domains-routing-runtime-proof.ts";
