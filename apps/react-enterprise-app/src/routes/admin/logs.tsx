import { createRoute } from "@tanstack/react-router";
import { Route as rootRoute } from "../__root";
import { ProtectedRoute } from "../../components/ProtectedRoute";
import { AdminLogsPage } from "../../features/admin-logs/AdminLogsPage";

export const Route = createRoute({
  getParentRoute: () => rootRoute,
  path: "/admin/logs",
  component: AdminLogsRoute,
});

function AdminLogsRoute() {
  return (
    <ProtectedRoute permission="platform.logs.read">
      <AdminLogsPage />
    </ProtectedRoute>
  );
}
