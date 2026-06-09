import type { LoginProvider } from "../../auth/login-providers.ts";

/** Default mock-mode provider list (platform + three brokered upstreams). */
export const providersFixture: LoginProvider[] = [
  {
    id: "google",
    label: "Continue with Google",
    type: "oidc",
    loginUrl: "/auth/login?provider=google",
    enabled: true,
    mode: "mock",
  },
  {
    id: "azure",
    label: "Continue with Microsoft",
    type: "oidc",
    loginUrl: "/auth/login?provider=azure",
    enabled: true,
    mode: "mock",
  },
  {
    id: "apple",
    label: "Continue with Apple",
    type: "oidc",
    loginUrl: "/auth/login?provider=apple",
    enabled: true,
    mode: "mock",
  },
  {
    id: "platform",
    label: "Continue with platform account",
    type: "keycloak",
    loginUrl: "/auth/login?provider=platform",
    enabled: true,
    mode: "internal",
  },
];

/** Disabled/real-without-config state: only the platform login. */
export const platformOnlyProvidersFixture: LoginProvider[] = providersFixture.filter(
  (p) => p.id === "platform"
);
