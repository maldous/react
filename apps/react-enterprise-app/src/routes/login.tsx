import { createRoute } from "@tanstack/react-router";
import { Route as RootRoute } from "./__root";
import { useTranslation } from "@platform/i18n-runtime";
import { Card, CardBody } from "@platform/ui-design-system";
import {
  useLoginProviders,
  providerLabelKey,
  type LoginProvider,
} from "../auth/login-providers.ts";

/**
 * Application login selector — /login (ADR-ACT-0155, ADR-ACT-0157).
 *
 * Renders the brokered login options from the BFF (GET /api/auth/providers) and
 * links each to the BFF handoff (/auth/login?provider=<id>) via a full-page <a>,
 * which Caddy proxies to platform-api. The SPA never links to Keycloak or the
 * upstream/mock identity provider directly — Keycloak is always the broker.
 */
export const Route = createRoute({
  getParentRoute: () => RootRoute,
  path: "/login",
  component: LoginPage,
});

function ProviderButton({ provider }: { provider: LoginProvider }) {
  const t = useTranslation();
  const key = providerLabelKey(provider.id);
  const label = key ? t(key) : provider.label;
  // The platform option keeps the legacy testid so existing E2E helpers (which
  // click "sign-in-button" to drive the platform login) continue to work.
  const testId = provider.id === "platform" ? "sign-in-button" : `login-provider-${provider.id}`;
  const isPlatform = provider.type === "keycloak";
  return (
    <a
      href={provider.loginUrl}
      data-testid={testId}
      data-provider={provider.id}
      className={
        isPlatform
          ? "flex w-full items-center justify-center rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          : "flex w-full items-center justify-center rounded-md border border-border bg-surface px-4 py-2.5 text-sm font-medium text-fg shadow-sm hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
      }
    >
      {label}
    </a>
  );
}

export function LoginPage() {
  const t = useTranslation();
  const { data: providers, isLoading, isError } = useLoginProviders();

  return (
    <main
      id="main-content"
      className="app-safe-x flex min-h-screen flex-col items-center justify-center bg-surface-muted p-8"
    >
      <div className="w-full max-w-sm space-y-8">
        {/* Platform branding */}
        <div className="text-center">
          <div
            className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-2xl text-primary-foreground shadow-md"
            aria-hidden="true"
          >
            ⬡
          </div>
          <h1 className="mt-4 text-2xl font-bold tracking-tight text-fg">{t("platform.name")}</h1>
          <p className="mt-1 text-sm text-fg-muted">{t("platform.tagline")}</p>
        </div>

        {/* Sign-in card */}
        <Card>
          <CardBody className="space-y-4 p-8">
            <div>
              <h2 className="text-base font-semibold text-fg">{t("auth.login.title")}</h2>
              <p className="mt-1 text-sm text-fg-muted">{t("auth.login.chooseProvider")}</p>
            </div>

            {isLoading && (
              <p data-testid="login-loading" className="text-sm text-fg-muted">
                {t("auth.login.loading")}
              </p>
            )}

            {isError && (
              <div role="alert" data-testid="login-error" className="text-sm text-danger">
                {t("auth.login.error")}
              </div>
            )}

            {!isLoading && !isError && providers && providers.length === 0 && (
              <p data-testid="login-empty" className="text-sm text-fg-muted">
                {t("auth.login.empty")}
              </p>
            )}

            {!isLoading && !isError && providers && providers.length > 0 && (
              <div data-testid="login-providers" className="space-y-3">
                {providers.map((p) => (
                  <ProviderButton key={p.id} provider={p} />
                ))}
              </div>
            )}
          </CardBody>
        </Card>

        <p className="text-center text-xs text-fg-muted">{t("auth.login.footer")}</p>
      </div>
    </main>
  );
}
