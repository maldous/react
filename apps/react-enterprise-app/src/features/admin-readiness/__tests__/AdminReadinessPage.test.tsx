import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { axe } from "vitest-axe";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createRouter, createRootRoute, createRoute } from "@tanstack/react-router";
import { I18nProvider, enGB } from "@platform/i18n-runtime";
import type { ReactNode } from "react";
import {
  server,
  sessionHandler,
  adminReadinessHandler,
  adminGetErrorHandler,
  tenantReadinessBlockedFixture,
} from "../../../msw";
import { AdminReadinessPage } from "../AdminReadinessPage";

// AdminReadinessPage renders TanStack Router <Link>s, so it needs a router
// context. Mount it under a minimal in-memory router at the index route.
function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const rootRoute = createRootRoute();
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: AdminReadinessPage,
  });
  const router = createRouter({ routeTree: rootRoute.addChildren([indexRoute]) });
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

describe("AdminReadinessPage", () => {
  it("renders the overall readiness banner and grouped capability cards", async () => {
    server.use(sessionHandler("tenantAdmin"), adminReadinessHandler());
    renderPage();
    expect(await screen.findByTestId("readiness-overall")).toHaveTextContent(/ready/i);
    expect(screen.getByTestId("readiness-category-identity")).toBeInTheDocument();
    expect(screen.getByTestId("readiness-category-authentication")).toBeInTheDocument();
    expect(screen.getByTestId("readiness-cap-auth_providers")).toBeInTheDocument();
  });

  it("links a configured capability to its admin route", async () => {
    server.use(sessionHandler("tenantAdmin"), adminReadinessHandler());
    renderPage();
    const link = await screen.findByTestId("readiness-cap-auth_providers-link");
    expect(link).toHaveAttribute("href", "/admin/auth");
  });

  it("shows the implementation badge for deferred capabilities and no manage link", async () => {
    server.use(sessionHandler("tenantAdmin"), adminReadinessHandler());
    renderPage();
    const storage = await screen.findByTestId("readiness-cap-storage");
    expect(within(storage).getByTestId("readiness-cap-storage-status")).toHaveTextContent(
      /planned/i
    );
    expect(screen.queryByTestId("readiness-cap-storage-link")).not.toBeInTheDocument();
  });

  it("surfaces missing-action hints for blocked capabilities", async () => {
    server.use(sessionHandler("tenantAdmin"), adminReadinessHandler(tenantReadinessBlockedFixture));
    renderPage();
    expect(await screen.findByTestId("readiness-overall")).toHaveTextContent(/blocked/i);
    expect(screen.getByTestId("readiness-cap-auth_credential-action")).toHaveTextContent(
      enGB.feature.admin.readiness.cap.auth_credential.action
    );
    expect(screen.getByTestId("readiness-cap-auth_credential-status")).toHaveTextContent(
      /blocked/i
    );
  });

  it("shows a retryable error when readiness cannot be read", async () => {
    server.use(sessionHandler("tenantAdmin"), adminGetErrorHandler("/api/org/readiness", 500));
    renderPage();
    await screen.findByTestId("admin-error-error");
  });

  it("has no accessibility violations", async () => {
    server.use(sessionHandler("tenantAdmin"), adminReadinessHandler());
    const { container } = renderPage();
    await screen.findByTestId("readiness-overall");
    expect(await axe(container)).toHaveNoViolations();
  });
});
