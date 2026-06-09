/**
 * mock-oidc configuration. NON-PRODUCTION fixture.
 *
 * Drives three brokered upstream IdP personas (mock-google / mock-azure /
 * mock-apple) from a single process, one node-oidc-provider instance per
 * provider mounted under a path prefix that matches its issuer.
 *
 * Split-horizon (see docs/local-development/mock-identity.md):
 *  - PUBLIC_URL  — browser-facing issuer base (e.g. http://localhost:9080).
 *                  The authorization endpoint + interaction picker live here.
 *  - INTERNAL_URL — Keycloak-backchannel base (e.g. http://mock-oidc:8080).
 *                  Keycloak calls token/jwks/userinfo here. Configured on the
 *                  Keycloak IdP explicitly, so discovery host never matters.
 * The id_token `iss` is always PUBLIC_URL/<provider>; Keycloak validates it as a
 * string against the IdP's configured `issuer`, so the two horizons never clash.
 */
import type { JWK } from "oidc-provider";

export const PROVIDERS = ["google", "azure", "apple"] as const;
export type ProviderKey = (typeof PROVIDERS)[number];

/** Keycloak broker alias for each provider persona (kc_idp_hint target). */
export const PROVIDER_ALIAS: Record<ProviderKey, string> = {
  google: "mock-google",
  azure: "mock-azure",
  apple: "mock-apple",
};

export interface MockOidcConfig {
  /** Internal listen port inside the container. */
  port: number;
  /** Browser-facing base URL — the OIDC issuer base. */
  publicUrl: string;
  /** Deterministic Keycloak realm these fixtures broker into. */
  realm: string;
  /** Keycloak browser-facing broker base, used to whitelist redirect_uris. */
  kcBrokerBase: string;
  /** Extra redirect_uris (comma-separated) to allow alongside the derived KC ones. */
  extraRedirectUris: string[];
  /** Deterministic fixture client secret shared with the Keycloak IdP config. */
  clientSecret: string;
}

function envUrl(name: string, fallback: string): string {
  return (process.env[name] ?? fallback).replace(/\/+$/, "");
}

export function loadConfig(): MockOidcConfig {
  const realm = process.env["MOCK_OIDC_REALM"] ?? "platform";
  // Default KC broker base targets local dev Keycloak (published on :8090, path /kc).
  const kcBrokerBase = envUrl(
    "MOCK_OIDC_KC_BROKER_BASE",
    `http://localhost:8090/kc/realms/${realm}/broker`
  );
  return {
    port: Number(process.env["PORT"] ?? process.env["MOCK_OIDC_INTERNAL_PORT"] ?? 8080),
    publicUrl: envUrl("MOCK_OIDC_PUBLIC_URL", "http://localhost:9080"),
    realm,
    kcBrokerBase,
    extraRedirectUris: (process.env["MOCK_OIDC_EXTRA_REDIRECT_URIS"] ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    clientSecret: process.env["MOCK_OIDC_CLIENT_SECRET"] ?? "mock-oidc-shared-secret",
  };
}

/** Deterministic client_id the Keycloak IdP presents to this mock provider. */
export function clientIdFor(provider: ProviderKey): string {
  return `kc-broker-${provider}`;
}

/** The Keycloak broker callback that the auth-code response must redirect to. */
export function redirectUrisFor(cfg: MockOidcConfig, provider: ProviderKey): string[] {
  const alias = PROVIDER_ALIAS[provider];
  return [`${cfg.kcBrokerBase}/${alias}/endpoint`, ...cfg.extraRedirectUris];
}

export function issuerFor(cfg: MockOidcConfig, provider: ProviderKey): string {
  return `${cfg.publicUrl}/${provider}`;
}

/**
 * Deterministic NON-PRODUCTION RS256 signing key. Committed on purpose so JWKS,
 * id_token signatures and broker validation are stable across restarts and CI.
 * This key has no production value and must never be used outside dev/test.
 */
export const SIGNING_JWK: JWK = {
  kty: "RSA",
  use: "sig",
  alg: "RS256",
  kid: "mock-oidc-dev-key-1",
  n: "wFmk9MsB9lOcFpg60REyxzaZ2NavJqLo0YQkn22qxWbpkMvWFv1iknjMeC3kErE0-E-YYHGWlwGp6vBxQIeMHFyBtl5g6OVNCLpuPC8WeSprtLXdCb0H3zVG-ezeYKZo147jYvF1t0I2HNoOCr4G6g4THxX_6wylk0ClMB4UpiMqQ-1nPHCCdpo-GWB3sndRFIjZo4c3KQYJOb3YB31esbyxO3tVPFHFGfVEOFl4e00eV55gHV3cq73rQhyNqbqHsfvUEBI1AZKt2JazxEXys1wNRDun7FMO513Xv1cSyUQPD0siZey0SLjwPQQMg1IAqVdfqIQ4SgLQsDO_D7ZQlw",
  e: "AQAB",
  d: "QT5G7wdq73gVsi5JiP-Z5yuUjJHpUCQi72owl-k1awbIw6X4RM0GoeMai8sZGOQFsRIif9gXeboFPhz3dSlk83vHPaoOmgCpHARMftqD925VoTKsunBlWqcyH3TiSws29aLQaw-224W4YBnweGFTbBGBF-K47yvXf7aGMWeKnn0oVt81CSXubab10VChDFz--zyT_-6EsHiDZvExFqktNIFuDrkUhMv8BceIz-Na-QAbit-rU9UTNMBIFFWL9WTFJ-W-NgCTQWCZgOGqVmO90kHSc8zbmYyOVMyM3aIC8S4JdJGfRZBbBj8rvN5SAu6s8LEw2HvOxeL5M0DopFUUkQ",
  p: "-zVA9J_GL_z_GfkOAjRRlfXPEfEiPVGWNX1Dmi2PP8ZyEOAQGD0sPlHB7af1bWaWV8gT_8JWnJYb_GkZ4uFNg-eYX6yOYN_pwIuAHVvKrEA-mvDeG7tAjWGO0lczL79Xf_pPg5CnpZUvz951OqhsgALpwKbTZqXaHV8m1MWcnZE",
  q: "xAT3BC89DijoRvQ0PHbor2k9o15pgZVdqt8VK0h3MzJ0WVWzEt8pBJr1WGD0GfSuP1Nq6WeJO8p7yZXqWORGc7_aMQQWk7RZeNxamwl6PffNqOTVuHp5lVUP1SJpLGOhRR-ffJfbpfuqUP8GO5958ry16e9X9Oy7PlON0Uprl6c",
  dp: "90Z5dRLdZJl2hxuItZTIhoPbW_7vxEpOQMLYS6jzLETsPT5BuYplxcZ2zbiaNyFXdnslbIng9ewxCipu58z9n4zWib7yu9tNXlIzPzL-8sWemqflCoktRr40d0qMwUBpIjnEEW7QB4ct9EE3RhFKFExJynCtAYrahDUIpUMMInE",
  dq: "ZWr8MxoNyOm5ZByteis7sKYO0hvjErypPeM2HLLdmYudTytb_4OewVc7YYKoSVWjYfhS9HgxNNJKwb3jBiL1oKW-ymWHGNzS_glkh5qbuLwhmCTtvwj_JxhfnLK1H9ZcdlsqNViMuJBBSq7oFqkoe0LQDD1dkMd7CYBJe-O5Tzk",
  qi: "QxtJRvR8ivrkIhHBr1yzPBKDFPyYOO-HOPfvc-p-IiuaVP42ibnEMldxILiBPzeANTyyk4zSzI-nuL2CSFr7fIpaSATAkp4RJsNLtYEmDQhL8K_m1jZIVDcdifwoE0Li9EnUBhcVL5l_fhs4DjkFtHC7NcHcaBiyjdDJWqRAP7o",
};
