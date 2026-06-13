import { createRoute } from "@tanstack/react-router";
import { Route as AdminLayoutRoute } from "./layout";
import { RequirePermission } from "../../components/RequirePermission";
import { AdminScheduledJobsPage } from "../../features/admin-scheduled-jobs/AdminScheduledJobsPage";

export const Route = createRoute({
  getParentRoute: () => AdminLayoutRoute,
  path: "scheduled-jobs",
  component: AdminScheduledJobsRoute,
});

function AdminScheduledJobsRoute() {
  // Operator-only: built-in scheduled jobs on the event substrate.
  return (
    <RequirePermission permission="platform.jobs.read">
      <AdminScheduledJobsPage />
    </RequirePermission>
  );
}
