import { createRoute } from "@tanstack/react-router";
import { Route as AdminLayoutRoute } from "./layout";
import { RequirePermission } from "../../components/RequirePermission";
import { AdminObservabilityPage } from "../../features/admin-observability/AdminObservabilityPage";

export const Route = createRoute({
  getParentRoute: () => AdminLayoutRoute,
  path: "observability",
  component: AdminObservabilityRoute,
});

function AdminObservabilityRoute() {
  return (
    <RequirePermission permission="tenant.observability.read">
      <AdminObservabilityPage />
    </RequirePermission>
  );
}
