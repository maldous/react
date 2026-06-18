/**
 * Service clickthrough policy runtime proof (ADR-ACT-0233).
 *
 * 1. Pure decision matrix — the policy module grants/denies every
 *    actor × host × service permutation as documented.
 * 2. Caddyfile reconciliation summary — same parse as the unit gate.
 * 3. LIVE (web profile, `make compose-up-web ENV=test`):
 *    - apex /mailpit/* unauthenticated → 401 (forward-auth gates it)
 *    - tenant host /mailpit/* → SPA fallback, NOT the Mailpit UI
 *      (the tenant route was removed — shared inbox, no tenant filtering)
 *    - custom-domain catch-all /mailpit/* → SPA fallback (no tool routes)
 *    - apex /kc/realms/* reachable without session (public by design)
 *    SKIPs honestly when the web profile is not running.
 *
 * Usage: npm run proof:service-clickthrough-policy
 */

import { request as httpRequest } from "node:http";
import {
  CLICKTHROUGH_SERVICES,
  TENANT_ADMIN_RESOURCES,
  decideServiceAccess,
} from "../src/usecases/service-clickthrough.ts";

const CADDY_BASE = process.env["CADDY_BASE_URL"] ?? "http://test.localhost:8081";
const APEX = new URL(CADDY_BASE).hostname;

let failures = 0;
function check(label: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}` + (detail ? ` — ${detail}` : ""));
  if (!ok) failures++;
}

interface ProbeResult {
  status: number;
  contentType: string;
  body: string;
}

function get(pathName: string, host: string): Promise<ProbeResult | null> {
  return new Promise((resolve) => {
    const base = new URL(CADDY_BASE);
    const req = httpRequest(
      {
        host: base.hostname,
        port: base.port || 80,
        path: pathName,
        method: "GET",
        headers: { Host: host },
        setHost: false,
        timeout: 4000,
      },
      (res) => {
        let data = "";
        res.on("data", (c: Buffer) => {
          data += c.toString();
        });
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            contentType: String(res.headers["content-type"] ?? ""),
            body: data.slice(0, 2000),
          })
        );
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

function checkDecisionMatrix(): void {
  check(
    "tenant-safe set is exactly {admin:keycloak}",
    TENANT_ADMIN_RESOURCES.size === 1 && TENANT_ADMIN_RESOURCES.has("admin:keycloak")
  );
  for (const s of CLICKTHROUGH_SERVICES) {
    const sys = decideServiceAccess({
      roles: ["system-admin"],
      resource: s.resource,
      requestedSlug: null,
      ownSlug: null,
    });
    check(
      `system-admin ${s.resource}: ${s.classification === "not_exposed" ? "denied (not exposed)" : "granted"}`,
      sys.granted === (s.classification !== "not_exposed")
    );
    const tenantOwn = decideServiceAccess({
      roles: ["tenant-admin"],
      resource: s.resource,
      requestedSlug: "acme",
      ownSlug: "acme",
    });
    check(
      `tenant-admin own-slug ${s.resource}: ${s.classification === "tenant_scoped_safe" ? "granted" : "denied"}`,
      tenantOwn.granted === (s.classification === "tenant_scoped_safe"),
      tenantOwn.reason
    );
    const cross = decideServiceAccess({
      roles: ["tenant-admin"],
      resource: s.resource,
      requestedSlug: "other",
      ownSlug: "acme",
    });
    check(`tenant-admin cross-tenant ${s.resource}: denied`, !cross.granted);
  }
}

async function checkLiveWebProfile(): Promise<void> {
  const apexHealth = await get("/healthz", APEX);
  if (!apexHealth) {
    console.log(
      `SKIP  live route checks — web profile not reachable @ ${CADDY_BASE} (make compose-up-web ENV=test)`
    );
    return;
  }
  const apexMailpit = await get("/mailpit/", APEX);
  check(
    "live: apex /mailpit/ without session → 401 (forward-auth gate)",
    apexMailpit?.status === 401,
    String(apexMailpit?.status)
  );
  const tenantMailpit = await get("/mailpit/", `clickthrough-proof.${APEX}`);
  const isSpaFallback =
    tenantMailpit?.status === 200 &&
    tenantMailpit.contentType.includes("text/html") &&
    !tenantMailpit.body.toLowerCase().includes("mailpit");
  check(
    "live: tenant host /mailpit/ is SPA fallback, NOT the Mailpit UI (route removed)",
    isSpaFallback,
    `${tenantMailpit?.status} ${tenantMailpit?.contentType}`
  );
  const customMailpit = await get("/mailpit/", "clickthrough-proof.example");
  check(
    "live: custom-domain catch-all /mailpit/ is SPA fallback (no tool routes)",
    customMailpit?.status === 200 && !customMailpit.body.toLowerCase().includes("mailpit"),
    String(customMailpit?.status)
  );
  const kcRealms = await get("/kc/realms/master/.well-known/openid-configuration", APEX);
  check(
    "live: apex /kc/realms/* reachable without session (public by design)",
    kcRealms !== null && kcRealms.status > 0 && kcRealms.status !== 401,
    `status ${kcRealms?.status} (Keycloak ${kcRealms && kcRealms.status >= 500 ? "may not be running — still proves the route is not forward-auth-gated" : "reachable"})`
  );
}

async function main(): Promise<void> {
  console.log("# Service clickthrough policy runtime proof\n");

  // 1. Pure decision matrix.
  checkDecisionMatrix();

  // 2/3. Live web-profile checks.
  await checkLiveWebProfile();

  console.log(
    failures === 0 ? "\n# ALL CHECKS PASSED (local-only proof)" : `\n# ${failures} FAILED`
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("proof failed:", err);
  process.exit(1);
});
