import { createRoute } from "@tanstack/react-router";
import { Route as AdminLayoutRoute } from "./layout";
import { RequirePermission } from "../../components/RequirePermission";
import { AdminMembersPage } from "../../features/admin-members/AdminMembersPage";

export const Route = createRoute({
  getParentRoute: () => AdminLayoutRoute,
  path: "members",
  component: AdminMembersRoute,
});

function AdminMembersRoute() {
  return (
    <RequirePermission permission="tenant.members.read">
      <AdminMembersPage />
    </RequirePermission>
  );
}
