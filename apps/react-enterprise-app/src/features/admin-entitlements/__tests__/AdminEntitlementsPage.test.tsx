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
  adminEntitlementsHandlers,
  adminTenantsLookupHandler,
  adminGetErrorHandler,
} from "../../../msw";
import { AdminEntitlementsPage } from "../AdminEntitlementsPage";

// Pick the "fixture-org" tenant from the lookup Select (operator console).
async function selectFixtureTenant() {
  const region = await screen.findByTestId("entitlement-tenant-form");
  await userEvent.click(within(region).getByRole("button"));
  await userEvent.click(await screen.findByRole("option", { name: /fixture-org/i }));
}

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
  return render(<AdminEntitlementsPage />, { wrapper: Wrapper });
}

describe("AdminEntitlementsPage", () => {
  it("shows the read-only own-tenant view for a tenant admin", async () => {
    server.use(sessionHandler("tenantAdmin"), ...adminEntitlementsHandlers());
    renderPage();
    expect(await screen.findByTestId("entitlement-readonly-note")).toBeInTheDocument();
    const rows = await screen.findAllByTestId("entitlement-row");
    expect(rows).toHaveLength(2);
    // No grant/revoke controls in read-only mode.
    expect(screen.queryByTestId("entitlement-tenant-form")).not.toBeInTheDocument();
    expect(screen.queryByTestId("entitlement-toggle-webhooks")).not.toBeInTheDocument();
  });

  it("lets a system operator pick a tenant (by name, not raw UUID) and grant/revoke", async () => {
    server.use(
      sessionHandler("systemAdmin"),
      adminTenantsLookupHandler(),
      ...adminEntitlementsHandlers()
    );
    renderPage();
    // Operator console offers a tenant picker (no raw UUID field).
    expect(screen.queryByTestId("entitlement-tenant-input")).not.toBeInTheDocument();
    await selectFixtureTenant();
    // A granted row offers Revoke; clicking it issues the mutation.
    const toggle = await screen.findByTestId("entitlement-toggle-webhooks");
    expect(toggle).toHaveTextContent(/revoke/i);
    await userEvent.click(toggle);
    await waitFor(() => expect(toggle).toBeEnabled());
  });

  it("renders a retryable error state when the operator list fails", async () => {
    server.use(
      sessionHandler("systemAdmin"),
      adminTenantsLookupHandler(),
      adminGetErrorHandler("/api/admin/tenants/:tenantId/entitlements", 500)
    );
    renderPage();
    await selectFixtureTenant();
    await screen.findByTestId("admin-error-error");
  });

  it("has no accessibility violations (read-only view)", async () => {
    server.use(sessionHandler("tenantAdmin"), ...adminEntitlementsHandlers());
    const { container } = renderPage();
    await screen.findAllByTestId("entitlement-row");
    expect(await axe(container)).toHaveNoViolations();
  });
});
