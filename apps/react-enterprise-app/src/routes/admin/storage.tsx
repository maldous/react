import { createRoute } from "@tanstack/react-router";
import { Route as AdminLayoutRoute } from "./layout";
import { RequirePermission } from "../../components/RequirePermission";
import { AdminStoragePage } from "../../features/admin-storage/AdminStoragePage";

export const Route = createRoute({
  getParentRoute: () => AdminLayoutRoute,
  path: "storage",
  component: AdminStorageRoute,
});

function AdminStorageRoute() {
  return (
    <RequirePermission permission="tenant.storage.read">
      <AdminStoragePage />
    </RequirePermission>
  );
}
