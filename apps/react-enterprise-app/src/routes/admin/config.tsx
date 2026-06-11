import { createRoute } from "@tanstack/react-router";
import { Route as AdminLayoutRoute } from "./layout";
import { RequirePermission } from "../../components/RequirePermission";
import { AdminConfigPage } from "../../features/admin-config/AdminConfigPage";

export const Route = createRoute({
  getParentRoute: () => AdminLayoutRoute,
  path: "config",
  component: AdminConfigRoute,
});

function AdminConfigRoute() {
  return (
    <RequirePermission permission="tenant.config.read">
      <AdminConfigPage />
    </RequirePermission>
  );
}
