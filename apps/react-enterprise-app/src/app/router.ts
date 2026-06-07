import { createRouter } from "@tanstack/react-router";
import { routeTree } from "../routeTree.gen";
import { DefaultErrorComponent } from "../components/DefaultErrorComponent";
import { DefaultPendingComponent } from "../components/DefaultPendingComponent";
import { DefaultNotFoundComponent } from "../components/DefaultNotFoundComponent";

export const router = createRouter({
  routeTree,
  defaultErrorComponent: DefaultErrorComponent,
  defaultPendingComponent: DefaultPendingComponent,
  defaultNotFoundComponent: DefaultNotFoundComponent,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
