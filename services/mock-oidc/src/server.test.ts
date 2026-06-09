/**
 * Flow coverage for the mock-oidc fixture. Exercises the real auth-code dance
 * (authorize → picker → submit → code → token) against a live instance, so the
 * assertions cover signed ID tokens, dynamic nonce echo and scenario branching —
 * the behaviours WireMock cannot provide.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";

const PORT = 19099;
const BASE = `http://localhost:${PORT}`;
process.env["PORT"] = String(PORT);
process.env["MOCK_OIDC_PUBLIC_URL"] = BASE;

const REDIRECT = `${BASE}/__test/callback`;
process.env["MOCK_OIDC_EXTRA_REDIRECT_URIS"] = REDIRECT;

const { app } = await import("./server.ts");

let server: Server;
before(async () => {
  await new Promise<void>((resolve) => {
    server = app.listen(PORT, resolve);
  });
});
after(() => server?.close());

/** Minimal cookie jar over fetch with manual redirect handling. */
class Jar {
  private cookies = new Map<string, string>();
  private store(res: Response): void {
    for (const sc of res.headers.getSetCookie?.() ?? []) {
      const [pair] = sc.split(";");
      const eq = pair.indexOf("=");
      if (eq > 0) this.cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
  }
  private header(): string {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
  }
  async get(url: string): Promise<Response> {
    const res = await fetch(url, { redirect: "manual", headers: { cookie: this.header() } });
    this.store(res);
    return res;
  }
  async postForm(url: string, body: Record<string, string>): Promise<Response> {
    const res = await fetch(url, {
      method: "POST",
      redirect: "manual",
      headers: { cookie: this.header(), "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body).toString(),
    });
    this.store(res);
    return res;
  }
}

function authorizeUrl(provider: string): string {
  const q = new URLSearchParams({
    client_id: `kc-broker-${provider}`,
    response_type: "code",
    scope: "openid email profile",
    redirect_uri: REDIRECT,
    state: "state-xyz",
    nonce: "nonce-xyz",
  });
  return `${BASE}/${provider}/auth?${q.toString()}`;
}

/** Run authorize → picker → submit, returning the final redirect to redirect_uri. */
async function driveScenario(provider: string, scenario: string): Promise<URL> {
  const jar = new Jar();
  // authorize → 303 to interaction
  let res = await jar.get(authorizeUrl(provider));
  let loc = res.headers.get("location")!;
  // follow to picker (GET interaction)
  res = await jar.get(new URL(loc, BASE).toString());
  const html = await res.text();
  const uid = /interaction\/([^/]+)\/submit/.exec(html)?.[1];
  assert.ok(uid, "picker should expose an interaction uid");
  // submit scenario → 303 back to /auth/:uid
  res = await jar.postForm(`${BASE}/${provider}/interaction/${uid}/submit`, { scenario });
  loc = res.headers.get("location")!;
  // resume /auth → 303 to redirect_uri (with code or error)
  res = await jar.get(new URL(loc, BASE).toString());
  return new URL(res.headers.get("location")!);
}

function decodeJwtPayload(jwt: string): Record<string, unknown> {
  const part = jwt.split(".")[1];
  return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
}

test("verified scenario issues a signed id_token echoing the nonce", async () => {
  const redirect = await driveScenario("google", "verified");
  const code = redirect.searchParams.get("code");
  assert.equal(redirect.searchParams.get("state"), "state-xyz");
  assert.ok(code, "expected an authorization code");

  const tokenRes = await fetch(`${BASE}/google/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: code!,
      redirect_uri: REDIRECT,
      client_id: "kc-broker-google",
      client_secret: "mock-oidc-shared-secret",
    }).toString(),
  });
  assert.equal(tokenRes.status, 200);
  const tokens = (await tokenRes.json()) as { id_token: string };
  const claims = decodeJwtPayload(tokens.id_token);
  assert.equal(claims["iss"], `${BASE}/google`);
  assert.equal(claims["nonce"], "nonce-xyz");
  assert.equal(claims["email"], "verified.google@mock-idp.test");
  assert.equal(claims["email_verified"], true);
});

test("unverified scenario marks email_verified=false", async () => {
  const redirect = await driveScenario("azure", "unverified");
  const code = redirect.searchParams.get("code")!;
  const tokenRes = await fetch(`${BASE}/azure/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT,
      client_id: "kc-broker-azure",
      client_secret: "mock-oidc-shared-secret",
    }).toString(),
  });
  const tokens = (await tokenRes.json()) as { id_token: string };
  assert.equal(decodeJwtPayload(tokens.id_token)["email_verified"], false);
});

test("denied scenario returns access_denied to the broker", async () => {
  const redirect = await driveScenario("apple", "denied");
  assert.equal(redirect.searchParams.get("error"), "access_denied");
  assert.equal(redirect.searchParams.get("state"), "state-xyz");
  assert.equal(redirect.searchParams.get("code"), null);
});

test("provider-error scenario returns temporarily_unavailable", async () => {
  const redirect = await driveScenario("google", "provider-error");
  assert.equal(redirect.searchParams.get("error"), "temporarily_unavailable");
});
