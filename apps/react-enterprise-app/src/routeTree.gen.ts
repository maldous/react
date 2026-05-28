import { Route as RootRoute } from "./routes/__root";
import { Route as IndexRoute } from "./routes/index";
import { Route as AuthLoginRoute } from "./routes/auth/login";

const routeTree = RootRoute.addChildren([IndexRoute, AuthLoginRoute]);

export { routeTree };
