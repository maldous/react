// E2E substrate harness route. Not part of product navigation.
// Excluded from production builds via NODE_ENV check would be a future enhancement.
import { createRoute } from "@tanstack/react-router";
import { Route as AuthenticatedRoute } from "./_authenticated";
import { RequirePermission } from "../components/RequirePermission";
import { useTranslation } from "@platform/i18n-runtime";

export const Route = createRoute({
  getParentRoute: () => AuthenticatedRoute,
  path: "/e2e-harness",
  component: E2EHarnessPage,
});

function E2EHarnessPage() {
  const t = useTranslation();
  if (!import.meta.env.DEV) return null;
  return (
    <RequirePermission permission="organisation.read">
      <div data-testid="protected-content">
        <h1>{t("e2e.harness.title")}</h1>
        <p>{t("e2e.harness.authenticatedMessage")}</p>
      </div>
    </RequirePermission>
  );
}
