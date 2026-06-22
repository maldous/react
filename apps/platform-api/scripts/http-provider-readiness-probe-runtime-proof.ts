/**
 * Provider-ID proof entrypoint for the generic HTTP provider readiness probe.
 *
 * The substantive proof lives in composed-provider-readiness-runtime-proof.ts and exercises
 * ready, degraded, not_configured, adapter-confirmed lifecycle, and secret-free payloads.
 * This provider-named wrapper lets assurance attach that runtime proof to the
 * http-provider-readiness-probe adapter without changing validator logic.
 */

import "./composed-provider-readiness-runtime-proof.ts";
