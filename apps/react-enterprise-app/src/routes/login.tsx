import { createRoute } from "@tanstack/react-router";
import { Route as RootRoute } from "./__root";
import { useTranslation } from "@platform/i18n-runtime";
import { Card, CardBody } from "@platform/ui-design-system";

/**
 * Application login entry — /login (ADR-ACT-0155, ADR-ACT-0157).
 *
 * Keycloak is the single login surface, but the SPA still owns the branded
 * entry screen and hands off through the BFF login start. We keep the call to
 * action visible so browser tests can exercise the full /login → /auth/login →
 * Keycloak flow deterministically.
 */
export const Route = createRoute({
  getParentRoute: () => RootRoute,
  path: "/login",
  component: LoginPage,
});

/** BFF login start (platform ⇒ no kc_idp_hint ⇒ Keycloak shows username/password +
 * the brokered IdP buttons). prompt=login is added by the BFF. */
const KC_LOGIN_URL = "/auth/login?provider=platform";

/** True when the BFF or the Keycloak theme bounced the browser back to /login after a
 * failed sign-in (any `?authError=` code). One generic message — never Keycloak detail. */
function hasSignInError(): boolean {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).has("authError");
}

export function LoginPage() {
  const t = useTranslation();
  const failed = hasSignInError();

  return (
    <main
      id="main-content"
      className="auth-gutter-x flex min-h-screen flex-col items-center justify-start bg-surface-muted pb-8 pt-20"
    >
      <div className="w-full max-w-sm space-y-8">
        {/* Platform branding — top-anchored (pt-20) so the badge + name sit at the same
            place as the Keycloak login page (visual consistency across auth pages). */}
        <div className="text-center">
          <div
            className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-2xl text-primary-foreground shadow-md"
            aria-hidden="true"
          >
            ⬡
          </div>
          <h1 className="mt-4 text-2xl font-bold tracking-tight text-fg">{t("platform.name")}</h1>
        </div>

        <Card>
          <CardBody className="p-8">
            <div className="space-y-6 text-center">
              {failed ? (
                <p role="alert" data-testid="login-auth-error" className="text-sm text-danger">
                  {t("auth.login.signInFailed")}
                </p>
              ) : (
                <p className="text-sm text-fg-muted">{t("auth.login.loading")}</p>
              )}
              <a
                href={KC_LOGIN_URL}
                data-testid="sign-in-button"
                className="flex items-center justify-center rounded-lg bg-primary px-4 py-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
              >
                {failed ? t("auth.login.tryAgain") : t("auth.login.signInButton")}
              </a>
            </div>
          </CardBody>
        </Card>
      </div>
    </main>
  );
}
