import { createRoute } from "@tanstack/react-router";
import { Route as AdminLayoutRoute } from "./layout";
import { RequirePermission } from "../../components/RequirePermission";
import { AdminAccountPage } from "../../features/admin-account/AdminAccountPage";

export const Route = createRoute({
  getParentRoute: () => AdminLayoutRoute,
  path: "account",
  component: AdminAccountRoute,
});

function AdminAccountRoute() {
  // Self-service profile + notification preferences; operator notifications section
  // renders only for platform.notifications.write (server-authoritative).
  return (
    <RequirePermission permission="profile.read_self">
      <AdminAccountPage />
    </RequirePermission>
  );
}
