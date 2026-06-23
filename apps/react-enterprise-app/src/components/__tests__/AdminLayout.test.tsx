import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nProvider, enGB } from "@platform/i18n-runtime";
import {
  createRootRoute,
  createRouter,
  createMemoryHistory,
  RouterProvider,
} from "@tanstack/react-router";
import type { ReactNode } from "react";
import { server, sessionHandler } from "../../msw";
import { AdminLayout } from "../AdminLayout";

/** Mount AdminLayout inside a minimal router (it renders TanStack Link + Outlet). */
function renderLayout() {
  const rootRoute = createRootRoute({ component: AdminLayout });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <I18nProvider locale="en-GB" messages={enGB}>
          {children}
        </I18nProvider>
      </QueryClientProvider>
    );
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return render(<RouterProvider router={router as any} />, { wrapper: Wrapper });
}

describe("AdminLayout", () => {
  it("shows the management sections a tenant admin can reach", async () => {
    server.use(sessionHandler("tenantAdmin"));
    renderLayout();
    expect(await screen.findByTestId("admin-nav-members")).toBeInTheDocument();
    expect(screen.getByTestId("admin-nav-auth")).toBeInTheDocument();
    expect(screen.getByTestId("admin-nav-features")).toBeInTheDocument();
    // Real anchors (keyboard/touch friendly, no hover-only nav).
    expect(screen.getByTestId("admin-nav-members").tagName).toBe("A");
  });

  it("hides sections the user lacks permission for", async () => {
    server.use(sessionHandler("noMembership"));
    renderLayout();
    await screen.findByTestId("admin-nav");
    expect(screen.queryByTestId("admin-nav-members")).not.toBeInTheDocument();
    expect(screen.queryByTestId("admin-nav-auth")).not.toBeInTheDocument();
    expect(screen.queryByTestId("admin-nav-features")).not.toBeInTheDocument();
  });

  it("has no accessibility violations", async () => {
    server.use(sessionHandler("tenantAdmin"));
    const { container } = renderLayout();
    await screen.findByTestId("admin-nav-members");
    expect(await axe(container)).toHaveNoViolations();
  });
});
