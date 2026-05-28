import { createRoute } from "@tanstack/react-router";
import { Route as RootRoute } from "../__root";

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
  return (
    <div className="flex min-h-screen items-center justify-center p-8">
      <div className="max-w-md text-center">
        <h1 className="text-2xl font-semibold text-gray-900">Sign in</h1>
        <p className="mt-2 text-gray-500">
          Authentication is not yet configured. SSO wiring is tracked in ADR-ACT-0108.
        </p>
      </div>
    </div>
  );
}
