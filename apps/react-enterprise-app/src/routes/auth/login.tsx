import { createRoute } from "@tanstack/react-router";
import { Route as RootRoute } from "../__root";
import { useTranslation } from "@platform/i18n-runtime";

/**
 * Login route — registered in the router tree so ProtectedRoute can
 * navigate to "/auth/login" with type-safety (no casts needed).
 * Full login implementation tracked in ADR-ACT-0106 / ADR-ACT-0108.
 */
export const Route = createRoute({
  getParentRoute: () => RootRoute,
  path: "/auth/login",
  component: LoginPage,
});

function LoginPage() {
  const t = useTranslation();
  return (
    <div className="flex min-h-screen items-center justify-center p-8">
      <div className="max-w-md text-center">
        <h1 className="text-2xl font-semibold text-gray-900">{t("auth.login.title")}</h1>
        <p className="mt-2 text-gray-500">{t("auth.login.body")}</p>
      </div>
    </div>
  );
}
