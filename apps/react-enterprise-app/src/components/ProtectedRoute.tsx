import { type ReactNode } from "react";
import { Navigate } from "@tanstack/react-router";
import { LoadingState, ForbiddenState } from "@platform/ui-design-system";
import { useSession } from "../hooks/use-session";
import { useTranslation } from "@platform/i18n-runtime";

interface ProtectedRouteProps {
  permission?: string;
  children: ReactNode;
}

export function ProtectedRoute({ permission, children }: ProtectedRouteProps) {
  const { actor: _actor, isLoading, isAuthenticated, hasPermission, error } = useSession();
  const t = useTranslation();

  if (isLoading) return <LoadingState message={t("auth.status.checkingAuthentication")} />;
  if (error) return <div role="alert">{t("ui.error.sessionUnavailable")}</div>;
  // Redirect to the React-rendered login entry page; /auth/login is BFF-only (Caddy-proxied)
  if (!isAuthenticated) return <Navigate to="/login" />;
  if (permission && !hasPermission(permission)) {
    return (
      <ForbiddenState
        title={t("ui.accessDenied.title")}
        description={t("ui.accessDenied.description", { permission })}
      />
    );
  }
  return <>{children}</>;
}
