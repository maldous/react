import { createRoute } from "@tanstack/react-router";
import { Route as AdminLayoutRoute } from "./layout";
import { RequirePermission } from "../../components/RequirePermission";
import { AdminDeveloperPage } from "../../features/admin-developer/AdminDeveloperPage";

export const Route = createRoute({
  getParentRoute: () => AdminLayoutRoute,
  path: "developer",
  component: AdminDeveloperRoute,
});

function AdminDeveloperRoute() {
  // Read permission gates the route; create/revoke + rate-limit-set controls render
  // only for the actor's write permissions (server-authoritative).
  return (
    <RequirePermission permission="tenant.developer.read">
      <AdminDeveloperPage />
    </RequirePermission>
  );
}
