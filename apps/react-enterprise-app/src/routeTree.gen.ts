import { Route as RootRoute } from "./routes/__root";
import { Route as IndexRoute } from "./routes/index";
import { Route as AuthLoginRoute } from "./routes/auth/login";
import { Route as ProtectedTestRoute } from "./routes/protected-test";

const routeTree = RootRoute.addChildren([IndexRoute, AuthLoginRoute, ProtectedTestRoute]);

export { routeTree };
