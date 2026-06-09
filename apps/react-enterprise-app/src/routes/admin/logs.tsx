import { createRoute } from "@tanstack/react-router";
import { Route as AuthenticatedRoute } from "../_authenticated";
import { RequirePermission } from "../../components/RequirePermission";
import { AdminLogsPage } from "../../features/admin-logs/AdminLogsPage";
import {
  parseLogSearchParams,
  type LogSearchParams,
} from "../../features/admin-logs/admin-logs.schema";

export const Route = createRoute({
  getParentRoute: () => AuthenticatedRoute,
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
    <RequirePermission permission="platform.logs.read">
      <AdminLogsPage search={search} onSearchChange={(params) => navigate({ search: params })} />
    </RequirePermission>
  );
}
