/**
 * Global setup for the broker login E2E (ADR-ACT-0157).
 *
 * Ensures the dedicated E2E app origin is a registered redirect URI on the
 * platform-api Keycloak client, so the real OAuth code flow is accepted. Uses
 * the Keycloak master admin (admin-cli password grant) — dev/test only. Raw
 * fetch only (no @platform imports) so Playwright's loader can run it directly.
 */
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

export default async function globalSetup(): Promise<void> {
  const token = await adminToken();
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

  const list = (await (
    await fetch(`${KC_URL}/admin/realms/${REALM}/clients?clientId=${BFF_CLIENT_ID}`, { headers })
  ).json()) as Array<{ id: string; redirectUris?: string[] }>;
  const client = list[0];
  if (!client) throw new Error(`Keycloak client ${BFF_CLIENT_ID} not found in realm ${REALM}`);

  const want = [`${APP_ORIGIN}/*`, `${APP_ORIGIN}/auth/callback`];
  const current = new Set(client.redirectUris ?? []);
  const missing = want.filter((u) => !current.has(u));
  if (missing.length === 0) {
    console.log(`[identity-e2e] redirect URIs already registered for ${APP_ORIGIN}`);
    return;
  }
  const redirectUris = [...current, ...missing];
  const res = await fetch(`${KC_URL}/admin/realms/${REALM}/clients/${client.id}`, {
    method: "PUT",
    headers,
    body: JSON.stringify({ redirectUris }),
  });
  if (!res.ok) throw new Error(`Failed to register redirect URIs: ${res.status}`);
  console.log(`[identity-e2e] registered redirect URIs for ${APP_ORIGIN}: ${missing.join(", ")}`);
}
