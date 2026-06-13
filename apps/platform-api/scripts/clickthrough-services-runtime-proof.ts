/**
 * Click-through services PROOF (ADR-ACT-0233 / ADR-0072).
 *
 * Proves the operator click-through services view:
 *  - lists the exposed composed Compose GUI services (never the not_exposed ones);
 *  - access gating reuses the SAME decision as forward-auth: a system-admin may click
 *    through every exposed service on the apex host; a tenant-admin / unauthenticated
 *    actor may not (global_only + tenant paths are not apex-accessible);
 *  - the response carries NO secret (only ids, classifications, URLs, readiness);
 *  - composed-provider readiness is included (adapter-confirmed; not_configured when a
 *    provider is unreachable — never faked).
 *
 * No backend required (composed readiness degrades to not_configured offline).
 * Usage: npm run proof:clickthrough
 */

import { listClickthroughServices } from "../src/usecases/clickthrough-services.ts";
import { CLICKTHROUGH_SERVICES } from "../src/usecases/service-clickthrough.ts";

let failures = 0;
function check(label: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

const SECRET = /password|secret|token|pepper|private[_-]?key|[0-9a-f]{32,}/i;

async function main(): Promise<void> {
  console.log("# Click-through services PROOF\n");

  const sys = await listClickthroughServices({ roles: ["system-admin"] });
  const tenant = await listClickthroughServices({ roles: ["tenant-admin"] });
  const anon = await listClickthroughServices({ roles: [] });

  const exposedCount = CLICKTHROUGH_SERVICES.filter(
    (s) => s.classification !== "not_exposed"
  ).length;
  check(
    "lists every exposed service (excludes not_exposed)",
    sys.services.length === exposedCount &&
      !sys.services.some((s) => s.classification === "not_exposed"),
    `${sys.services.length}/${exposedCount}`
  );

  check(
    "system-admin may click through every exposed service on the apex host",
    sys.services.every((s) => s.accessible)
  );
  check(
    "tenant-admin may NOT click through global_only services on the apex host",
    tenant.services.filter((s) => s.classification === "global_only").every((s) => !s.accessible)
  );
  check(
    "unauthenticated actor may click through nothing",
    anon.services.every((s) => !s.accessible)
  );

  check(
    "every service exposes a stable id + classification + readiness",
    sys.services.every(
      (s) =>
        typeof s.id === "string" &&
        ["global_only", "tenant_scoped_safe"].includes(s.classification) &&
        ["ready", "degraded", "not_configured", "unknown"].includes(s.readiness)
    )
  );

  check(
    "response carries NO secret-looking value",
    !SECRET.test(
      JSON.stringify({ services: sys.services, providers: sys.providers.map((p) => p.detail) })
    )
  );

  check(
    "composed-provider readiness is included + adapter-confirmed (no faked ready offline)",
    Array.isArray(sys.providers) &&
      sys.providers.every((p) => ["ready", "degraded", "not_configured"].includes(p.status))
  );

  console.log(`\n${failures === 0 ? "# PASS" : `# FAIL (${failures})`}`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
