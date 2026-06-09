import { Route as RootRoute } from "./routes/__root";
import { Route as IndexRoute } from "./routes/index";
import { Route as LoginRoute } from "./routes/login";
import { Route as E2EHarnessRoute } from "./routes/e2e-harness";
import { Route as OrganisationProfileRoute } from "./routes/organisation/profile";
import { Route as AdminLogsRoute } from "./routes/admin/logs";

const routeTree = RootRoute.addChildren([
  IndexRoute,
  LoginRoute,
  E2EHarnessRoute,
  OrganisationProfileRoute,
  AdminLogsRoute,
]);

export { routeTree };
