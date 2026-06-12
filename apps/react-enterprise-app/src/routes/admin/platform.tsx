import { createRoute } from "@tanstack/react-router";
import { Route as AdminLayoutRoute } from "./layout";
import { RequirePermission } from "../../components/RequirePermission";
import { AdminPlatformPage } from "../../features/admin-platform/AdminPlatformPage";

export const Route = createRoute({
  getParentRoute: () => AdminLayoutRoute,
  path: "platform",
  component: AdminPlatformRoute,
});

function AdminPlatformRoute() {
  return (
    <RequirePermission permission="tenant.platform.read">
      <AdminPlatformPage />
    </RequirePermission>
  );
}
