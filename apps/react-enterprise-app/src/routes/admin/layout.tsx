import { createRoute } from "@tanstack/react-router";
import { Route as AuthenticatedRoute } from "../_authenticated";
import { AdminLayout } from "../../components/AdminLayout";

/**
 * Admin shell layout route (ADR-0036). Pathful parent `/admin` under the
 * `_authenticated` layout; renders the admin nav + an `<Outlet/>`. It does not
 * gate access itself — each child section enforces its own permission via
 * `RequirePermission`, and the nav only lists items the user can reach.
 */
export const Route = createRoute({
  getParentRoute: () => AuthenticatedRoute,
  path: "/admin",
  component: AdminLayout,
});
