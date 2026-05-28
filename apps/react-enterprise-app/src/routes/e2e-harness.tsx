// E2E substrate harness route. Not part of product navigation.
// Excluded from production builds via NODE_ENV check would be a future enhancement.
import { createRoute } from "@tanstack/react-router";
import { Route as rootRoute } from "./__root";
import { ProtectedRoute } from "../components/ProtectedRoute";

export const Route = createRoute({
  getParentRoute: () => rootRoute,
  path: "/e2e-harness",
  component: E2EHarnessPage,
});

function E2EHarnessPage() {
  return (
    <ProtectedRoute permission="organisation.read">
      <div data-testid="protected-content">
        <h1>E2E Harness Route</h1>
        <p>You are authenticated with organisation.read permission.</p>
      </div>
    </ProtectedRoute>
  );
}
