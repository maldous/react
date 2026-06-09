import { createRoute } from "@tanstack/react-router";
import { Route as rootRoute } from "../__root";
import { ProtectedRoute } from "../../components/ProtectedRoute";
import { AdminLogsPage } from "../../features/admin-logs/AdminLogsPage";
import {
  parseLogSearchParams,
  type LogSearchParams,
} from "../../features/admin-logs/admin-logs.schema";

export const Route = createRoute({
  getParentRoute: () => rootRoute,
  path: "/admin/logs",
  // Typed, bookmarkable search params (ADR-0019 §2). Lenient parse applies
  // defaults and never throws on a hand-edited URL.
  validateSearch: (search: Record<string, unknown>): LogSearchParams =>
    parseLogSearchParams(search),
  component: AdminLogsRoute,
});

function AdminLogsRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <ProtectedRoute permission="platform.logs.read">
      <AdminLogsPage search={search} onSearchChange={(params) => navigate({ search: params })} />
    </ProtectedRoute>
  );
}
