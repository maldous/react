import { Route as RootRoute } from "./routes/__root";
import { Route as IndexRoute } from "./routes/index";
import { Route as LoginRoute } from "./routes/login";
import { Route as AuthenticatedRoute } from "./routes/_authenticated";
import { Route as E2EHarnessRoute } from "./routes/e2e-harness";
import { Route as OrganisationProfileRoute } from "./routes/organisation/profile";
import { Route as AdminLogsRoute } from "./routes/admin/logs";

// Hand-maintained route tree (no router codegen plugin is configured). Public
// routes (`/`, `/login`) are direct children of the root; protected feature
// routes are nested under the pathless `_authenticated` layout route, which owns
// the auth gate and the shared AppShell chrome (ADR-ACT-0203).
const routeTree = RootRoute.addChildren([
  IndexRoute,
  LoginRoute,
  AuthenticatedRoute.addChildren([E2EHarnessRoute, OrganisationProfileRoute, AdminLogsRoute]),
]);

export { routeTree };
