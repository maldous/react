import { createRoute } from "@tanstack/react-router";
import { Route as AdminLayoutRoute } from "./layout";
import { RequirePermission } from "../../components/RequirePermission";
import { AdminClickthroughPage } from "../../features/admin-clickthrough/AdminClickthroughPage";

export const Route = createRoute({
  getParentRoute: () => AdminLayoutRoute,
  path: "clickthrough",
  component: AdminClickthroughRoute,
});

function AdminClickthroughRoute() {
  return (
    <RequirePermission permission="platform.providers.read">
      <AdminClickthroughPage />
    </RequirePermission>
  );
}
