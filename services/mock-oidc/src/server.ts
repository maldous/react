/**
 * mock-oidc HTTP entrypoint. NON-PRODUCTION upstream IdP fixture.
 *
 * One express app fronts three node-oidc-provider instances (google/azure/apple).
 * For each provider we register, in order:
 *   1. GET  /<p>/interaction/:uid          → scenario picker page
 *   2. POST /<p>/interaction/:uid/submit   → finish login or return an OAuth error
 *   3. use  /<p>                           → the OIDC provider (auth/token/jwks/userinfo/discovery)
 * The interaction routes are registered before the catch-all provider mount.
 */
import express, { type Request, type Response } from "express";
import type Provider from "oidc-provider";
import { loadConfig, PROVIDERS, PROVIDER_ALIAS, type ProviderKey } from "./config.ts";
import { buildProvider } from "./providers.ts";
import { SCENARIOS, SCENARIO_META, isScenario } from "./scenarios.ts";
import { accountId } from "./users.ts";
import { logger } from "./logger.ts";

const cfg = loadConfig();
const app = express();
app.disable("x-powered-by");

// Body parsing is applied ONLY to the picker-submit route. The OIDC provider's
// token endpoint (under oidc.callback()) parses its own body, so a global parser
// would double-consume it.
const formBody = express.urlencoded({ extended: false });

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!
  );
}

function pickerPage(provider: ProviderKey, uid: string): string {
  const buttons = SCENARIOS.map((scenario) => {
    const meta = SCENARIO_META[scenario];
    return `<form method="post" action="/${provider}/interaction/${escapeHtml(uid)}/submit">
      <input type="hidden" name="scenario" value="${scenario}" />
      <button type="submit" data-testid="scenario-${scenario}">
        <strong>${escapeHtml(meta.label)}</strong>
        <span>${escapeHtml(meta.description)}</span>
      </button>
    </form>`;
  }).join("\n");

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>mock-oidc · ${escapeHtml(provider)}</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 32rem; margin: 3rem auto; padding: 0 1rem; }
  h1 { font-size: 1.25rem; } .tag { color:#b91c1c; font-weight:600; }
  button { display:block; width:100%; text-align:left; padding:.75rem 1rem; margin:.5rem 0;
           border:1px solid #d1d5db; border-radius:.5rem; background:#fff; cursor:pointer; }
  button strong { display:block; } button span { color:#6b7280; font-size:.85rem; }
</style></head>
<body data-testid="mock-oidc-picker" data-provider="${escapeHtml(provider)}">
  <h1>Mock identity provider — <code>${escapeHtml(provider)}</code></h1>
  <p class="tag">NON-PRODUCTION fixture. Choose a sign-in outcome:</p>
  ${buttons}
</body></html>`;
}

function mountProvider(provider: ProviderKey, oidc: Provider): void {
  const base = `/${provider}`;

  // 1. Picker page for the login interaction.
  app.get(`${base}/interaction/:uid`, async (req: Request, res: Response) => {
    try {
      const details = await oidc.interactionDetails(req, res);
      logger.info("interaction.start", {
        provider,
        uid: details.uid,
        prompt: details.prompt.name,
      });
      res.set("Cache-Control", "no-store").type("html").send(pickerPage(provider, details.uid));
    } catch (err) {
      logger.error("interaction.details_failed", { provider, error: String(err) });
      res.status(400).type("text/plain").send("interaction expired or invalid");
    }
  });

  // 2. Picker submission → resolve the chosen scenario.
  app.post(`${base}/interaction/:uid/submit`, formBody, async (req: Request, res: Response) => {
    const scenario = String((req.body as Record<string, unknown>)["scenario"] ?? "");
    if (!isScenario(scenario)) {
      res.status(400).type("text/plain").send("unknown scenario");
      return;
    }
    const meta = SCENARIO_META[scenario];
    try {
      const details = await oidc.interactionDetails(req, res);

      if (meta.kind === "error") {
        logger.info("interaction.error_outcome", { provider, scenario, code: meta.errorCode });
        await oidc.interactionFinished(
          req,
          res,
          { error: meta.errorCode!, error_description: meta.errorDescription },
          { mergeWithLastSubmission: false }
        );
        return;
      }

      const id = accountId(provider, scenario);
      const clientId = String(details.params["client_id"]);
      const scope = String(details.params["scope"] ?? "openid email profile");

      // Auto-grant the requested scopes so there is no second consent prompt.
      const grant = new oidc.Grant({ accountId: id, clientId });
      grant.addOIDCScope(scope);
      const grantId = await grant.save();

      logger.info("interaction.login", { provider, scenario, accountId: id, clientId });
      await oidc.interactionFinished(
        req,
        res,
        { login: { accountId: id }, consent: { grantId } },
        { mergeWithLastSubmission: false }
      );
    } catch (err) {
      logger.error("interaction.submit_failed", { provider, scenario, error: String(err) });
      res.status(400).type("text/plain").send("interaction expired or invalid");
    }
  });

  // 3. The OIDC provider itself (auth/token/jwks/userinfo/discovery).
  app.use(base, oidc.callback());
  logger.info("provider.mounted", { provider, alias: PROVIDER_ALIAS[provider], base });
}

// Health + index.
app.get(["/healthz", "/__mock/health"], (_req, res) => {
  res.json({ status: "ok", service: "mock-oidc", providers: PROVIDERS });
});
app.get("/", (_req, res) => {
  const links = PROVIDERS.map(
    (p) =>
      `<li><a href="/${p}/.well-known/openid-configuration">${p}</a> (alias ${PROVIDER_ALIAS[p]})</li>`
  ).join("");
  res.type("html").send(`<h1>mock-oidc (NON-PRODUCTION)</h1><ul>${links}</ul>`);
});

for (const provider of PROVIDERS) {
  mountProvider(provider, buildProvider(cfg, provider));
}

// Only listen when run directly (tests import the app/builders instead).
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  app.listen(cfg.port, () => {
    logger.warn("mock-oidc listening — NON-PRODUCTION identity fixture", {
      port: cfg.port,
      publicUrl: cfg.publicUrl,
      realm: cfg.realm,
      providers: PROVIDERS,
    });
  });
}

export { app, cfg };
