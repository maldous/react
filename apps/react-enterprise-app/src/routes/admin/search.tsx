import { createRoute } from "@tanstack/react-router";
import { Route as AdminLayoutRoute } from "./layout";
import { RequirePermission } from "../../components/RequirePermission";
import { AdminSearchPage } from "../../features/admin-search/AdminSearchPage";

export const Route = createRoute({
  getParentRoute: () => AdminLayoutRoute,
  path: "search",
  component: AdminSearchRoute,
});

function AdminSearchRoute() {
  // Read permission gates the route; reindex controls render only for operators
  // holding platform.search.write (server-authoritative).
  return (
    <RequirePermission permission="tenant.search.read">
      <AdminSearchPage />
    </RequirePermission>
  );
}
