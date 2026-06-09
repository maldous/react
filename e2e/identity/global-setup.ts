/**
 * Global setup for the broker login E2E (ADR-ACT-0157).
 *
 * Ensures the dedicated E2E app origin is a registered redirect URI on the
 * platform-api Keycloak client, so the real OAuth code flow is accepted. Uses
 * the Keycloak master admin (admin-cli password grant) — dev/test only. Raw
 * fetch only (no @platform imports) so Playwright's loader can run it directly.
 *
 * It GETs the FULL client representation and PUTs a non-destructive merge back
 * (see mergeClientRedirects), preserving every existing client field. Idempotent:
 * when the redirect URIs are already present, no PUT is made.
 */
import { mergeClientRedirects, type KeycloakClientRep } from "./redirect-merge.ts";

const KC_URL = (process.env["KEYCLOAK_URL"] ?? "http://localhost:8090/kc").replace(/\/+$/, "");
const REALM = process.env["KEYCLOAK_REALM"] ?? "platform";
const ADMIN_USER = process.env["KEYCLOAK_ADMIN_USER"] ?? "admin";
const ADMIN_PASSWORD = process.env["KEYCLOAK_ADMIN_PASSWORD"] ?? "admin";
const BFF_CLIENT_ID = process.env["KEYCLOAK_CLIENT_ID"] ?? "platform-api";
const APP_PORT = process.env["E2E_APP_PORT"] ?? "5180";
const APP_ORIGIN = `http://localhost:${APP_PORT}`;

async function adminToken(): Promise<string> {
  const res = await fetch(`${KC_URL}/realms/master/protocol/openid-connect/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "password",
      client_id: "admin-cli",
      username: ADMIN_USER,
      password: ADMIN_PASSWORD,
    }),
  });
  if (!res.ok) throw new Error(`Keycloak admin token failed: ${res.status} (is Keycloak up?)`);
  return ((await res.json()) as { access_token: string }).access_token;
}

async function safeBody(res: Response): Promise<string> {
  try {
    return (await res.text()).replace(/\s+/g, " ").trim().slice(0, 300);
  } catch {
    return "<unreadable body>";
  }
}

export default async function globalSetup(): Promise<void> {
  const token = await adminToken();
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

  // 1. Find the platform-api client id.
  const listRes = await fetch(
    `${KC_URL}/admin/realms/${REALM}/clients?clientId=${encodeURIComponent(BFF_CLIENT_ID)}`,
    { headers }
  );
  if (!listRes.ok) {
    throw new Error(`list clients failed: ${listRes.status} ${await safeBody(listRes)}`);
  }
  const list = (await listRes.json()) as Array<{ id: string }>;
  const id = list[0]?.id;
  if (!id) throw new Error(`Keycloak client ${BFF_CLIENT_ID} not found in realm ${REALM}`);

  // 2. GET the FULL client representation so the PUT preserves every field.
  const getRes = await fetch(`${KC_URL}/admin/realms/${REALM}/clients/${id}`, { headers });
  if (!getRes.ok) {
    throw new Error(`get client failed: ${getRes.status} ${await safeBody(getRes)}`);
  }
  const client = (await getRes.json()) as KeycloakClientRep;

  // 3. Merge the E2E origin's redirect URIs (+ web origin) into the full rep.
  const want = [`${APP_ORIGIN}/*`, `${APP_ORIGIN}/auth/callback`];
  const { merged, changed } = mergeClientRedirects(client, want, [APP_ORIGIN]);
  if (!changed) {
    console.log(`[identity-e2e] redirect URIs already registered for ${APP_ORIGIN}`);
    return;
  }

  // 4. PUT the full merged representation back.
  const putRes = await fetch(`${KC_URL}/admin/realms/${REALM}/clients/${id}`, {
    method: "PUT",
    headers,
    body: JSON.stringify(merged),
  });
  if (!putRes.ok) {
    throw new Error(`register redirect URIs failed: ${putRes.status} ${await safeBody(putRes)}`);
  }
  console.log(`[identity-e2e] registered redirect URIs for ${APP_ORIGIN}`);
}
