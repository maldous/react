import { createRoute } from "@tanstack/react-router";
import { Route as AdminLayoutRoute } from "./layout";
import { RequirePermission } from "../../components/RequirePermission";
import { AdminWebhooksPage } from "../../features/admin-webhooks/AdminWebhooksPage";

export const Route = createRoute({
  getParentRoute: () => AdminLayoutRoute,
  path: "webhooks",
  component: AdminWebhooksRoute,
});

function AdminWebhooksRoute() {
  return (
    <RequirePermission permission="tenant.webhooks.read">
      <AdminWebhooksPage />
    </RequirePermission>
  );
}
