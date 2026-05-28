import { createRoute } from "@tanstack/react-router";
import { Route as rootRoute } from "../__root";
import { ProtectedRoute } from "../../components/ProtectedRoute";
import { OrganisationProfilePage } from "../../features/organisation/OrganisationProfilePage";

export const Route = createRoute({
  getParentRoute: () => rootRoute,
  path: "/organisation/profile",
  component: OrganisationProfileRoute,
});

function OrganisationProfileRoute() {
  return (
    <ProtectedRoute permission="organisation.read">
      <OrganisationProfilePage />
    </ProtectedRoute>
  );
}
