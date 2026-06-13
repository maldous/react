import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nProvider, enGB } from "@platform/i18n-runtime";
import type { ReactNode } from "react";
import {
  server,
  sessionHandler,
  adminTenantsLookupHandler,
  adminSearchHandlers,
} from "../../../msw";
import { AdminSearchPage } from "../AdminSearchPage";

function renderPage() {
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
  return render(<AdminSearchPage />, { wrapper: Wrapper });
}

describe("AdminSearchPage", () => {
  it("lets a tenant run a search and shows ranked hits", async () => {
    server.use(sessionHandler("tenantAdmin"), ...adminSearchHandlers());
    renderPage();
    const q = await screen.findByTestId("search-query");
    await userEvent.type(q, "widget");
    await userEvent.click(screen.getByTestId("search-submit"));
    expect((await screen.findAllByTestId("search-hit-row")).length).toBeGreaterThan(0);
    // Tenant view: no operator readiness/reindex.
    expect(screen.queryByTestId("search-readiness")).not.toBeInTheDocument();
    expect(screen.queryByTestId("search-reindex-form")).not.toBeInTheDocument();
  });

  it("shows operator readiness and reindex for a system operator", async () => {
    server.use(
      sessionHandler("systemAdmin"),
      adminTenantsLookupHandler(),
      ...adminSearchHandlers()
    );
    renderPage();
    expect(await screen.findByTestId("search-readiness")).toBeInTheDocument();
    expect(await screen.findByTestId("search-reindex-form")).toBeInTheDocument();
  });

  it("renders an error state when the readiness read fails (operator)", async () => {
    const { adminGetErrorHandler } = await import("../../../msw");
    server.use(
      sessionHandler("systemAdmin"),
      adminTenantsLookupHandler(),
      adminGetErrorHandler("/api/admin/search/readiness", 500)
    );
    renderPage();
    await screen.findByTestId("admin-error-error");
  });

  it("has no accessibility violations (tenant view)", async () => {
    server.use(sessionHandler("tenantAdmin"), ...adminSearchHandlers());
    const { container } = renderPage();
    await screen.findByTestId("search-test-form");
    expect(await axe(container)).toHaveNoViolations();
  });
});
