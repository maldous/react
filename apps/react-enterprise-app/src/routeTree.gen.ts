import { Route as RootRoute } from "./routes/__root";
import { Route as IndexRoute } from "./routes/index";

const routeTree = RootRoute.addChildren([IndexRoute]);

export { routeTree };
