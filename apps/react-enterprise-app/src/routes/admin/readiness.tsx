import { createRoute } from "@tanstack/react-router";
import { Route as AdminLayoutRoute } from "./layout";
import { RequirePermission } from "../../components/RequirePermission";
import { AdminReadinessPage } from "../../features/admin-readiness/AdminReadinessPage";

export const Route = createRoute({
  getParentRoute: () => AdminLayoutRoute,
  path: "readiness",
  component: AdminReadinessRoute,
});

function AdminReadinessRoute() {
  return (
    <RequirePermission permission="tenant.admin.access">
      <AdminReadinessPage />
    </RequirePermission>
  );
}
