import { createRoute } from "@tanstack/react-router";
import { Route as RootRoute } from "../__root";
import { useTranslation } from "@platform/i18n-runtime";

/**
 * Platform login entry — Option B themed (ADR-ACT-0155).
 *
 * The "Sign in" button navigates to /auth/login on the BFF, which generates
 * the PKCE challenge and redirects to the Keycloak login page.
 * Keycloak itself is not yet theme-customised — tracked in ADR-ACT-0156.
 */
export const Route = createRoute({
  getParentRoute: () => RootRoute,
  path: "/auth/login",
  component: LoginPage,
});

function LoginPage() {
  const t = useTranslation();
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gray-50 p-8">
      <div className="w-full max-w-sm space-y-8">
        {/* Platform branding */}
        <div className="text-center">
          <div
            className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-600 text-2xl text-white shadow-md"
            aria-hidden="true"
          >
            ⬡
          </div>
          <h1 className="mt-4 text-2xl font-bold tracking-tight text-gray-900">
            {t("platform.name")}
          </h1>
          <p className="mt-1 text-sm text-gray-500">{t("platform.tagline")}</p>
        </div>

        {/* Sign-in card */}
        <div className="rounded-xl border border-gray-200 bg-white px-8 py-8 shadow-sm">
          <h2 className="mb-1 text-base font-semibold text-gray-900">{t("auth.login.title")}</h2>
          <p className="mb-6 text-sm text-gray-500">{t("auth.login.body")}</p>

          {/* Full-page navigation: triggers /auth/login BFF route → Keycloak PKCE flow */}
          <a
            href="/auth/login"
            className="flex w-full items-center justify-center rounded-md bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
            data-testid="sign-in-button"
          >
            {t("auth.login.signInButton")}
          </a>
        </div>

        <p className="text-center text-xs text-gray-400">{t("auth.login.footer")}</p>
      </div>
    </div>
  );
}
