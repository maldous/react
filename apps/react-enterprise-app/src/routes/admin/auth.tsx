import { createRoute } from "@tanstack/react-router";
import { Route as AdminLayoutRoute } from "./layout";
import { RequirePermission } from "../../components/RequirePermission";
import { AdminAuthPage } from "../../features/admin-auth/AdminAuthPage";

export const Route = createRoute({
  getParentRoute: () => AdminLayoutRoute,
  path: "auth",
  component: AdminAuthRoute,
});

function AdminAuthRoute() {
  return (
    <RequirePermission permission="tenant.auth.settings.read">
      <AdminAuthPage />
    </RequirePermission>
  );
}
