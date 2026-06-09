import { createRoute } from "@tanstack/react-router";
import { Route as AuthenticatedRoute } from "../_authenticated";
import { RequirePermission } from "../../components/RequirePermission";
import { OrganisationProfilePage } from "../../features/organisation/OrganisationProfilePage";

export const Route = createRoute({
  getParentRoute: () => AuthenticatedRoute,
  path: "/organisation/profile",
  component: OrganisationProfileRoute,
});

function OrganisationProfileRoute() {
  return (
    <RequirePermission permission="organisation.read">
      <OrganisationProfilePage />
    </RequirePermission>
  );
}
