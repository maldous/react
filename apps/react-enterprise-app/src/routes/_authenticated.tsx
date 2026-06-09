import { createRoute } from "@tanstack/react-router";
import { Route as RootRoute } from "./__root";
import { AuthenticatedLayout } from "../components/AuthenticatedLayout";

/**
 * Pathless authenticated layout route (ADR-0019, ADR-ACT-0203).
 *
 * Uses `id` (not `path`) so it contributes no URL segment: protected feature
 * routes declare it as their parent and keep their own paths. The layout owns
 * the authentication gate and the shared AppShell chrome (single
 * `<main id="main-content">`). Unauthenticated public routes (`/`, `/login`)
 * stay as direct children of the root route.
 */
export const Route = createRoute({
  getParentRoute: () => RootRoute,
  id: "_authenticated",
  component: AuthenticatedLayout,
});
