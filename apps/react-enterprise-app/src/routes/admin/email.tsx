import { createRoute } from "@tanstack/react-router";
import { Route as AdminLayoutRoute } from "./layout";
import { RequirePermission } from "../../components/RequirePermission";
import { AdminEmailPage } from "../../features/admin-email/AdminEmailPage";

export const Route = createRoute({
  getParentRoute: () => AdminLayoutRoute,
  path: "email",
  component: AdminEmailRoute,
});

function AdminEmailRoute() {
  return (
    <RequirePermission permission="tenant.email.settings.read">
      <AdminEmailPage />
    </RequirePermission>
  );
}
