import { createRoute } from "@tanstack/react-router";
import { Route as AdminLayoutRoute } from "./layout";
import { RequirePermission } from "../../components/RequirePermission";
import { AdminUsagePage } from "../../features/admin-usage/AdminUsagePage";

export const Route = createRoute({
  getParentRoute: () => AdminLayoutRoute,
  path: "usage",
  component: AdminUsageRoute,
});

function AdminUsageRoute() {
  // Read permission gates the route; quota-set controls render only for operators
  // holding platform.quotas.write (server-authoritative).
  return (
    <RequirePermission permission="tenant.metering.read">
      <AdminUsagePage />
    </RequirePermission>
  );
}
