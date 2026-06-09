import { Suspense } from "react";
import { createRootRoute, Outlet } from "@tanstack/react-router";

export const Route = createRootRoute({
  component: () => (
    <Suspense
      fallback={
        <div role="status" aria-live="polite">
          Loading…
        </div>
      }
    >
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded focus:bg-surface focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:ring-2 focus:ring-primary focus:ring-offset-2"
      >
        Skip to main content
      </a>
      <Outlet />
    </Suspense>
  ),
});
