import { Navigate, Outlet } from "@tanstack/react-router";
import { Alert, AlertDescription, LoadingState } from "@platform/ui-design-system";
import { useTranslation } from "@platform/i18n-runtime";
import { useSession } from "../hooks/use-session";
import { AppShell } from "./AppShell";

/**
 * Authenticated layout (ADR-0019, ADR-ACT-0195 promotion → ADR-ACT-0203).
 *
 * The component for the `_authenticated` pathless layout route. It owns the
 * single authentication gate for every protected feature route and renders the
 * shared {@link AppShell} chrome around the route Outlet — so feature pages
 * render page content only and there is exactly one `<main id="main-content">`.
 *
 * Session states (equivalent to the former per-page ProtectedRoute):
 *   loading        → accessible loading state
 *   session error  → assertive alert (non-401 /api/session failure)
 *   unauthenticated → redirect to the React /login entry
 *   authenticated  → AppShell + Outlet
 *
 * Per-route permission gating is layered on top by {@link RequirePermission}
 * inside each route, since authentication is already guaranteed here.
 */
export function AuthenticatedLayout() {
  const { isLoading, isAuthenticated, error } = useSession();
  const t = useTranslation();

  if (isLoading) return <LoadingState message={t("auth.status.checkingAuthentication")} />;
  if (error)
    return (
      <div className="mx-auto max-w-2xl p-8">
        <Alert variant="destructive">
          <AlertDescription>{t("ui.error.sessionUnavailable")}</AlertDescription>
        </Alert>
      </div>
    );
  // Redirect to the React-rendered login entry; /auth/login is BFF-only (Caddy-proxied).
  if (!isAuthenticated) return <Navigate to="/login" />;

  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}
