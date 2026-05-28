import { createRoute } from "@tanstack/react-router";
import { Route as rootRoute } from "./__root";
import { ProtectedRoute } from "../components/ProtectedRoute";

export const Route = createRoute({
  getParentRoute: () => rootRoute,
  path: "/protected-test",
  component: ProtectedTestPage,
});

function ProtectedTestPage() {
  return (
    <ProtectedRoute permission="organisation.read">
      <div data-testid="protected-content">
        <h1>Protected Test Route</h1>
        <p>You are authenticated with organisation.read permission.</p>
      </div>
    </ProtectedRoute>
  );
}
