import { createRoute } from "@tanstack/react-router";
import { Route as RootRoute } from "./__root";
import { useTranslation } from "@platform/i18n-runtime";
import { Card, CardBody } from "@platform/ui-design-system";

/**
 * Platform themed login entry — /login (ADR-ACT-0155, ADR-ACT-0156).
 *
 * This is the React-rendered login entry page. It is served by Caddy's
 * try_files fallback (same-origin SPA) and is distinct from /auth/login
 * which is the BFF OAuth endpoint Caddy proxies to platform-api.
 *
 * The "Sign in" button navigates to /auth/login via a full-page <a> tag,
 * which Caddy proxies to the BFF — generating the PKCE challenge and
 * redirecting to Keycloak.
 *
 * Keycloak itself is not yet theme-customised — tracked in ADR-ACT-0156.
 */
export const Route = createRoute({
  getParentRoute: () => RootRoute,
  path: "/login",
  component: LoginPage,
});

function LoginPage() {
  const t = useTranslation();
  return (
    <main
      id="main-content"
      className="app-safe-x flex min-h-screen flex-col items-center justify-center bg-gray-50 p-8"
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
          <h1 className="mt-4 text-2xl font-bold tracking-tight text-gray-900">
            {t("platform.name")}
          </h1>
          <p className="mt-1 text-sm text-gray-600">{t("platform.tagline")}</p>
        </div>

        {/* Sign-in card */}
        <Card>
          <CardBody className="space-y-4 p-8">
            <div>
              <h2 className="text-base font-semibold text-gray-900">{t("auth.login.title")}</h2>
              <p className="mt-1 text-sm text-gray-600">{t("auth.login.body")}</p>
            </div>

            {/* Full-page <a>: Caddy proxies /auth/login to the BFF PKCE flow */}
            <a
              href="/auth/login"
              className="flex w-full items-center justify-center rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
              data-testid="sign-in-button"
            >
              {t("auth.login.signInButton")}
            </a>
          </CardBody>
        </Card>

        <p className="text-center text-xs text-gray-600">{t("auth.login.footer")}</p>
      </div>
    </main>
  );
}
