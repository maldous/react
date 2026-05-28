import { type ReactNode } from "react";
import { Navigate } from "@tanstack/react-router";
import { LoadingState, ForbiddenState } from "@platform/ui-design-system";
import { useSession } from "../hooks/use-session";

interface ProtectedRouteProps {
  permission?: string;
  children: ReactNode;
}

export function ProtectedRoute({ permission, children }: ProtectedRouteProps) {
  const { actor, isLoading, isAuthenticated, hasPermission } = useSession();

  if (isLoading) return <LoadingState message="Checking authentication..." />;
  // "/auth/login" is registered in routeTree.gen.ts — type-safe, no cast needed
  if (!isAuthenticated) return <Navigate to="/auth/login" />;
  if (permission && !hasPermission(permission)) {
    return (
      <ForbiddenState
        title="Access denied"
        description={`You do not have the required permission: ${permission}`}
      />
    );
  }
  void actor;
  return <>{children}</>;
}
