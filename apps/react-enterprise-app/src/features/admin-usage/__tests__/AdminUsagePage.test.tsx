import { describe, it, expect } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nProvider, enGB } from "@platform/i18n-runtime";
import type { ReactNode } from "react";
import {
  server,
  sessionHandler,
  adminTenantsLookupHandler,
  adminUsageQuotaHandlers,
  adminGetErrorHandler,
} from "../../../msw";
import { AdminUsagePage } from "../AdminUsagePage";

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
  return render(<AdminUsagePage />, { wrapper: Wrapper });
}

async function selectFixtureTenant() {
  const region = await screen.findByTestId("usage-tenant-form");
  await userEvent.click(within(region).getByRole("button"));
  await userEvent.click(await screen.findByRole("option", { name: /fixture-org/i }));
}

describe("AdminUsagePage", () => {
  it("shows the tenant read-only usage view", async () => {
    server.use(sessionHandler("tenantAdmin"), ...adminUsageQuotaHandlers());
    renderPage();
    expect(await screen.findByTestId("usage-readonly-note")).toBeInTheDocument();
    expect((await screen.findAllByTestId("usage-row")).length).toBeGreaterThan(0);
    // No operator set-quota form in read-only mode.
    expect(screen.queryByTestId("usage-set-form")).not.toBeInTheDocument();
  });

  it("lets a system operator pick a tenant and see quotas + usage", async () => {
    server.use(
      sessionHandler("systemAdmin"),
      adminTenantsLookupHandler(),
      ...adminUsageQuotaHandlers()
    );
    renderPage();
    await selectFixtureTenant();
    expect(await screen.findByTestId("usage-set-form")).toBeInTheDocument();
    expect((await screen.findAllByTestId("quota-row")).length).toBeGreaterThan(0);
    // Operator mode, not the tenant read-only view.
    expect(screen.queryByTestId("usage-readonly-note")).not.toBeInTheDocument();
  });

  it("lets the operator set a quota limit (defaults need no extra selects)", async () => {
    server.use(
      sessionHandler("systemAdmin"),
      adminTenantsLookupHandler(),
      ...adminUsageQuotaHandlers()
    );
    renderPage();
    await selectFixtureTenant();
    const limit = await screen.findByTestId("usage-set-limit");
    await userEvent.clear(limit);
    await userEvent.type(limit, "5");
    await userEvent.click(screen.getByTestId("usage-set-submit"));
    // Mutation succeeds (MSW returns 200) → no error banner.
    await waitFor(() => expect(screen.queryByTestId("usage-set-error")).not.toBeInTheDocument());
  });

  it("renders an error state when the operator quota read fails", async () => {
    server.use(
      sessionHandler("systemAdmin"),
      adminTenantsLookupHandler(),
      adminGetErrorHandler("/api/admin/tenants/:tenantId/quotas", 500)
    );
    renderPage();
    await selectFixtureTenant();
    await screen.findByTestId("admin-error-error");
  });

  it("has no accessibility violations (read-only view)", async () => {
    server.use(sessionHandler("tenantAdmin"), ...adminUsageQuotaHandlers());
    const { container } = renderPage();
    await screen.findAllByTestId("usage-row");
    expect(await axe(container)).toHaveNoViolations();
  });
});
