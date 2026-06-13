import { createRoute } from "@tanstack/react-router";
import { Route as AdminLayoutRoute } from "./layout";
import { RequirePermission } from "../../components/RequirePermission";
import { AdminEntitlementsPage } from "../../features/admin-entitlements/AdminEntitlementsPage";

export const Route = createRoute({
  getParentRoute: () => AdminLayoutRoute,
  path: "entitlements",
  component: AdminEntitlementsRoute,
});

function AdminEntitlementsRoute() {
  // Read permission gates the route; the page itself shows grant/revoke controls
  // only to operators holding platform.entitlements.write (server-authoritative).
  return (
    <RequirePermission permission="tenant.entitlements.read">
      <AdminEntitlementsPage />
    </RequirePermission>
  );
}
