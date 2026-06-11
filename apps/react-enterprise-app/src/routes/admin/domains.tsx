import { createRoute } from "@tanstack/react-router";
import { Route as AdminLayoutRoute } from "./layout";
import { RequirePermission } from "../../components/RequirePermission";
import { AdminDomainsPage } from "../../features/admin-domains/AdminDomainsPage";

export const Route = createRoute({
  getParentRoute: () => AdminLayoutRoute,
  path: "domains",
  component: AdminDomainsRoute,
});

function AdminDomainsRoute() {
  return (
    <RequirePermission permission="tenant.domains.read">
      <AdminDomainsPage />
    </RequirePermission>
  );
}
