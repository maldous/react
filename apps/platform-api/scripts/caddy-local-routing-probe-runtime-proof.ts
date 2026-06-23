/**
 * Provider-ID proof entrypoint for the Caddy local routing probe.
 *
 * The substantive proof lives in tenant-domains-routing-runtime-proof.ts and exercises
 * local Caddy host routing to the correct tenant context, custom-domain catch-all routing,
 * unregistered host rejection, and honest TLS/public-routing deferral.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const delegatedProofSource = readFileSync(
  join(scriptDir, "tenant-domains-routing-runtime-proof.ts"),
  "utf8"
);
const adapterSource = readFileSync(
  join(scriptDir, "../src/adapters/caddy-local-routing-probe.ts"),
  "utf8"
);
const lifecycleSource = readFileSync(
  join(scriptDir, "../src/usecases/tenant-domain-lifecycle.ts"),
  "utf8"
);
const classifierSource = readFileSync(join(scriptDir, "../src/usecases/tenant-domains.ts"), "utf8");

assert.ok(
  delegatedProofSource.includes("INSERT INTO public.organisations") &&
    delegatedProofSource.includes("CREATE SCHEMA") &&
    delegatedProofSource.includes("tenant_settings") &&
    delegatedProofSource.includes("theme.displayName"),
  "delegated routing proof must assert tenant database and theme marker side effects"
);
assert.ok(
  delegatedProofSource.includes("/api/theme") &&
    delegatedProofSource.includes("tenant FQDN routed to the CORRECT tenant context") &&
    delegatedProofSource.includes("apexName !== marker") &&
    delegatedProofSource.includes("routing_local_active"),
  "delegated routing proof must assert Caddy-routed tenant context state"
);
assert.ok(
  delegatedProofSource.includes("/api/host-identity") &&
    delegatedProofSource.includes("Host: host") &&
    delegatedProofSource.includes("custom_domain") &&
    delegatedProofSource.includes("unregistered custom host resolves NO tenant"),
  "delegated routing proof must assert custom-domain catch-all state and unregistered-host failure mode"
);
assert.ok(
  delegatedProofSource.includes("local Caddy not reachable") &&
    delegatedProofSource.includes("SKIP") &&
    delegatedProofSource.includes("tls stays tls_unknown") &&
    delegatedProofSource.includes("DEFERRED"),
  "delegated routing proof must assert unreachable-provider and public-TLS deferral failure modes"
);
assert.ok(
  adapterSource.includes("http.request") &&
    adapterSource.includes("setHost: false") &&
    adapterSource.includes("timeout: PROBE_TIMEOUT_MS") &&
    adapterSource.includes("body === null") &&
    adapterSource.includes("tenantContextMatched"),
  "Caddy local routing adapter must assert bounded Host override, timeout, unreachable state, and tenant match state"
);
assert.ok(
  adapterSource.includes("failClosed") &&
    adapterSource.includes("degradedMode") &&
    adapterSource.includes("operatorRecovery"),
  "Caddy local routing adapter must publish fail-closed, health-check, and recovery semantics"
);
assert.ok(
  lifecycleSource.includes("Marks routing_local_active ONLY on a positive") &&
    lifecycleSource.includes("await deps.audit.emit") &&
    lifecycleSource.includes("markRoutingLocalActive") &&
    classifierSource.includes(
      'return p.reachable && p.tenantContextMatched ? "routing_local_active" : "routing_unknown"'
    ),
  "domain lifecycle must audit and persist routing state only after a positive local probe"
);

import "./tenant-domains-routing-runtime-proof.ts";
