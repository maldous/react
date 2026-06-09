/**
 * Builds one node-oidc-provider instance per provider persona.
 *
 * Each instance is mounted under /<provider> (issuer = PUBLIC_URL/<provider>) so
 * a single process serves mock-google, mock-azure and mock-apple as distinct
 * brokered IdPs. Our own interaction picker replaces the built-in dev views.
 */
import Provider, { type Configuration } from "oidc-provider";
import {
  type MockOidcConfig,
  type ProviderKey,
  SIGNING_JWK,
  clientIdFor,
  issuerFor,
  redirectUrisFor,
} from "./config.ts";
import { claimsFor } from "./users.ts";
import { isScenario, type Scenario } from "./scenarios.ts";

/**
 * accountId is "mock-<provider>-<scenario>"; derive the scenario back from it so
 * findAccount can resolve the right deterministic claims.
 */
function scenarioFromAccountId(provider: ProviderKey, id: string): Scenario {
  const suffix = id.replace(`mock-${provider}-`, "");
  return isScenario(suffix) ? suffix : "verified";
}

export function buildProvider(cfg: MockOidcConfig, provider: ProviderKey): Provider {
  const issuer = issuerFor(cfg, provider);

  const configuration: Configuration = {
    jwks: { keys: [SIGNING_JWK] },
    clients: [
      {
        client_id: clientIdFor(provider),
        client_secret: cfg.clientSecret,
        redirect_uris: redirectUrisFor(cfg, provider),
        grant_types: ["authorization_code"],
        response_types: ["code"],
        // Keycloak's OIDC broker authenticates at the token endpoint with
        // client_secret_post by default.
        token_endpoint_auth_method: "client_secret_post",
      },
    ],
    // Use our own picker; disable the bundled dev interaction views.
    features: {
      devInteractions: { enabled: false },
      userinfo: { enabled: true },
      revocation: { enabled: true },
    },
    // Keycloak broker login does not send PKCE upstream by default.
    pkce: { methods: ["S256"], required: () => false },
    // Surface email/profile in the id_token too (Keycloak reads claims from it),
    // not only from userinfo.
    conformIdTokenClaims: false,
    claims: {
      openid: ["sub"],
      email: ["email", "email_verified"],
      profile: ["name", "preferred_username"],
    },
    // Relative, prefixed path so the front-channel interaction stays on the
    // browser host the user already reached (no split-horizon redirect).
    interactions: {
      url(_ctx, interaction) {
        return `/${provider}/interaction/${interaction.uid}`;
      },
    },
    cookies: {
      keys: ["mock-oidc-dev-cookie-key"],
      short: { secure: false, sameSite: "lax" },
      long: { secure: false, sameSite: "lax" },
    },
    ttl: {
      AccessToken: 3600,
      IdToken: 3600,
      Interaction: 600,
      Session: 3600,
      Grant: 3600,
    },
    async findAccount(_ctx, id) {
      const scenario = scenarioFromAccountId(provider, id);
      const claims = claimsFor(provider, scenario);
      return {
        accountId: id,
        async claims() {
          return {
            sub: claims.sub,
            email: claims.email,
            email_verified: claims.email_verified,
            name: claims.name,
            preferred_username: claims.preferred_username,
          };
        },
      };
    },
  };

  const oidc = new Provider(issuer, configuration);
  // Trust the X-Forwarded-* headers Compose/Caddy may add; harmless in dev.
  oidc.proxy = true;
  return oidc;
}
