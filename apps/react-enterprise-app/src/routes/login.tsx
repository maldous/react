import { createRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { Route as RootRoute } from "./__root";
import { useTranslation } from "@platform/i18n-runtime";
import { Card, CardBody, LoadingState } from "@platform/ui-design-system";

/**
 * Application login entry — /login (ADR-ACT-0155, ADR-ACT-0157).
 *
 * Keycloak is the single login surface: its (platform-themed) page offers the
 * username/password form AND the brokered identity providers (Google / Microsoft /
 * Apple) via "Or sign in with". So /login simply hands straight off to the BFF login
 * start (which redirects to Keycloak) — the app no longer renders its own provider
 * chooser. The only time /login renders is after a failed sign-in (?authError=…), where
 * it shows one generic message and a button to try again.
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

  useEffect(() => {
    // No error ⇒ hand straight off to the Keycloak login (the single login surface).
    if (!failed && typeof window !== "undefined") {
      window.location.replace(KC_LOGIN_URL);
    }
  }, [failed]);

  return (
    <main
      id="main-content"
      className="app-safe-x flex min-h-screen flex-col items-center justify-start bg-surface-muted px-8 pb-8 pt-20"
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
          <CardBody className="space-y-5 p-8">
            {failed ? (
              <>
                <h2 className="text-base font-semibold text-fg">{t("auth.login.title")}</h2>
                <div
                  role="alert"
                  data-testid="login-auth-error"
                  className="rounded-lg border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger"
                >
                  {t("auth.login.signInFailed")}
                </div>
                <a
                  href={KC_LOGIN_URL}
                  data-testid="sign-in-button"
                  className="flex items-center justify-center rounded-lg bg-primary px-4 py-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                >
                  {t("auth.login.signInButton")}
                </a>
              </>
            ) : (
              <div data-testid="login-redirecting">
                <LoadingState message={t("auth.login.loading")} className="py-8" />
              </div>
            )}
          </CardBody>
        </Card>

        <p className="text-center text-xs text-fg-muted">{t("auth.login.footer")}</p>
      </div>
    </main>
  );
}
