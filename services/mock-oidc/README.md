# mock-oidc

**NON-PRODUCTION** upstream OpenID Connect identity-provider fixture. It emulates
Google / Microsoft (Azure) / Apple as three brokered upstream IdPs so the platform
can develop and demo "Continue with Google/Microsoft/Apple" **before** real provider
tenants exist — without ever changing the production architecture.

```text
React /login → BFF /auth/login?provider=<id> → Keycloak (broker)
            → mock-oidc (this service) → Keycloak callback → BFF /auth/callback → session
```

The React app never talks to this service directly. Keycloak is always the broker.
See `docs/local-development/mock-identity.md` for the full environment-mode policy and
the mock→real migration path.

> ⚠️ This service ships a **committed, non-secret RS256 signing key** and deterministic
> fixture users. It must never run as a real identity provider. WireMock is deliberately
> **not** used for OIDC: Keycloak performs a real authorization-code flow and validates a
> signed ID token with a dynamic `nonce`, which static stubs cannot satisfy.

## Personas

| Provider | Issuer (browser)       | Keycloak alias | Backchannel base (Keycloak → here) |
| -------- | ---------------------- | -------------- | ---------------------------------- |
| google   | `${PUBLIC_URL}/google` | `mock-google`  | `${INTERNAL_URL}/google`           |
| azure    | `${PUBLIC_URL}/azure`  | `mock-azure`   | `${INTERNAL_URL}/azure`            |
| apple    | `${PUBLIC_URL}/apple`  | `mock-apple`   | `${INTERNAL_URL}/apple`            |

Each issues discovery, `authorize`, `token`, `jwks`, `userinfo` (`/me`), signed ID
tokens, the auth-code flow with PKCE support, dynamic nonce echo, redirect_uri
validation and `state` preservation.

## Scenarios (the picker page)

When Keycloak redirects the browser to `authorize`, this service shows a minimal
account/scenario picker (it is a fixture — it does not imitate Google/Apple/Azure UI).
Selecting a scenario drives a deterministic outcome:

| Scenario         | Outcome                                                  |
| ---------------- | -------------------------------------------------------- |
| `verified`       | success — verified email, login completes end-to-end     |
| `unverified`     | `email_verified=false` — the BFF callback rejects it     |
| `denied`         | OAuth `access_denied` (user cancelled)                   |
| `provider-error` | OAuth `temporarily_unavailable` (upstream failure)       |
| `disabled`       | OAuth `access_denied` (account disabled at the provider) |

Playwright drives a scenario by clicking the `data-testid="scenario-<name>"` button.

## Split-horizon (why two base URLs)

- `MOCK_OIDC_PUBLIC_URL` (default `http://localhost:9080`) is the **browser-facing**
  issuer. The authorization endpoint and interaction picker live here; node-oidc-provider's
  interaction redirects are relative, so the front channel never leaves the browser host.
- Keycloak (in its container) reaches the **backchannel** endpoints (`token`/`jwks`/`userinfo`)
  over the host gateway at `http://host.docker.internal:9080/<p>` (this fixture is a shared
  service in the `react-shared` project, published once on the host). The Keycloak IdP is
  configured with **explicit endpoints** (no discovery import), so the issuer host and the
  backchannel host never need to be the same machine. The ID-token `iss` is always the public
  issuer and Keycloak validates it as a string against the configured `issuer` — no `/etc/hosts`
  needed.

## Environment variables

| Var                             | Default                                           | Purpose                                    |
| ------------------------------- | ------------------------------------------------- | ------------------------------------------ |
| `PORT`                          | `8080`                                            | Internal listen port (container).          |
| `MOCK_OIDC_PUBLIC_URL`          | `http://localhost:9080`                           | Browser-facing issuer base.                |
| `MOCK_OIDC_REALM`               | `platform`                                        | Keycloak realm these fixtures broker into. |
| `MOCK_OIDC_KC_BROKER_BASE`      | `http://localhost:8090/kc/realms/${realm}/broker` | Used to whitelist redirect_uris.           |
| `MOCK_OIDC_EXTRA_REDIRECT_URIS` | —                                                 | Extra allowed redirect_uris (CSV).         |
| `MOCK_OIDC_CLIENT_SECRET`       | `mock-oidc-shared-secret`                         | Shared with the Keycloak IdP config.       |

## Run

```bash
# Via Compose (recommended — runs alongside Keycloak on the same network):
make compose-up-identity            # Keycloak
make compose-up-identity-mocks      # this service
npm run seed:idps                   # register mock-* IdPs on the platform realm

# Standalone:
cd services/mock-oidc && npm install && npm run build && npm start
npm test                            # node --test flow coverage
```
