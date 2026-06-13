import { createRoute } from "@tanstack/react-router";
import { Route as AdminLayoutRoute } from "./layout";
import { RequirePermission } from "../../components/RequirePermission";
import { AdminMonitoringPage } from "../../features/admin-monitoring/AdminMonitoringPage";

export const Route = createRoute({
  getParentRoute: () => AdminLayoutRoute,
  path: "monitoring",
  component: AdminMonitoringRoute,
});

function AdminMonitoringRoute() {
  // Operator-only surface: metric signals, alert rules + evaluation, incident lifecycle.
  return (
    <RequirePermission permission="platform.observability.read">
      <AdminMonitoringPage />
    </RequirePermission>
  );
}
