import { createRoute } from "@tanstack/react-router";
import { Route as AdminLayoutRoute } from "./layout";
import { RequirePermission } from "../../components/RequirePermission";
import { AdminEventsPage } from "../../features/admin-events/AdminEventsPage";

export const Route = createRoute({
  getParentRoute: () => AdminLayoutRoute,
  path: "events",
  component: AdminEventsRoute,
});

function AdminEventsRoute() {
  // Operator-only surface: event bus, dead-letter queue, redrive, and worker runtime.
  return (
    <RequirePermission permission="platform.events.read">
      <AdminEventsPage />
    </RequirePermission>
  );
}
