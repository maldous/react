import { createRoute } from "@tanstack/react-router";
import { Route as AdminLayoutRoute } from "./layout";
import { RequirePermission } from "../../components/RequirePermission";
import { AdminFeaturesPage } from "../../features/admin-features/AdminFeaturesPage";

export const Route = createRoute({
  getParentRoute: () => AdminLayoutRoute,
  path: "features",
  component: AdminFeaturesRoute,
});

function AdminFeaturesRoute() {
  return (
    <RequirePermission permission="tenant.features.read">
      <AdminFeaturesPage />
    </RequirePermission>
  );
}
