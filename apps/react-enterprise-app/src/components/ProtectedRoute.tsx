import { type ReactNode } from "react";
import { Navigate } from "@tanstack/react-router";
import { LoadingState, ForbiddenState } from "@platform/ui-design-system";
import { useSession } from "../hooks/use-session";

interface ProtectedRouteProps {
  permission?: string;
  children: ReactNode;
}

// The /auth/login route will be added in ADR-ACT-0008.
// Cast to string to allow forward-reference before the route is defined in routeTree.gen.ts.
const AUTH_LOGIN_ROUTE = "/auth/login" as unknown as "/";

export function ProtectedRoute({ permission, children }: ProtectedRouteProps) {
  const { actor, isLoading, isAuthenticated, hasPermission } = useSession();

  if (isLoading) return <LoadingState message="Checking authentication..." />;
  if (!isAuthenticated) return <Navigate to={AUTH_LOGIN_ROUTE} />;
  if (permission && !hasPermission(permission)) {
    return (
      <ForbiddenState
        title="Access denied"
        description={`You do not have the required permission: ${permission}`}
      />
    );
  }
  // actor is available here — used for type narrowing in downstream consumers
  void actor;
  return <>{children}</>;
}
