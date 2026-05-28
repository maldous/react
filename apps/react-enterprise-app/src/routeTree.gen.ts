import { Route as RootRoute } from "./routes/__root";
import { Route as IndexRoute } from "./routes/index";
import { Route as AuthLoginRoute } from "./routes/auth/login";
import { Route as E2EHarnessRoute } from "./routes/e2e-harness";
import { Route as OrganisationProfileRoute } from "./routes/organisation/profile";

const routeTree = RootRoute.addChildren([
  IndexRoute,
  AuthLoginRoute,
  E2EHarnessRoute,
  OrganisationProfileRoute,
]);

export { routeTree };
