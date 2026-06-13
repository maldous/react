import { describe, it, expect } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nProvider, enGB } from "@platform/i18n-runtime";
import type { ReactNode } from "react";
import {
  server,
  sessionHandler,
  adminEntitlementsHandlers,
  adminGetErrorHandler,
} from "../../../msw";
import { AdminEntitlementsPage } from "../AdminEntitlementsPage";

const TENANT_ID = "00000000-0000-0000-0000-000000000001";

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

  it("lets a system operator load a tenant and grant/revoke", async () => {
    server.use(sessionHandler("systemAdmin"), ...adminEntitlementsHandlers());
    renderPage();
    // Operator console prompts for a tenant id first.
    await userEvent.type(await screen.findByTestId("entitlement-tenant-input"), TENANT_ID);
    await userEvent.click(screen.getByTestId("entitlement-tenant-load"));
    // A granted row offers Revoke; clicking it issues the mutation.
    const toggle = await screen.findByTestId("entitlement-toggle-webhooks");
    expect(toggle).toHaveTextContent(/revoke/i);
    await userEvent.click(toggle);
    await waitFor(() => expect(toggle).toBeEnabled());
  });

  it("renders a retryable error state when the operator list fails", async () => {
    server.use(
      sessionHandler("systemAdmin"),
      adminGetErrorHandler("/api/admin/tenants/:tenantId/entitlements", 500)
    );
    renderPage();
    await userEvent.type(await screen.findByTestId("entitlement-tenant-input"), TENANT_ID);
    await userEvent.click(screen.getByTestId("entitlement-tenant-load"));
    await screen.findByTestId("admin-error-error");
  });

  it("has no accessibility violations (read-only view)", async () => {
    server.use(sessionHandler("tenantAdmin"), ...adminEntitlementsHandlers());
    const { container } = renderPage();
    await screen.findAllByTestId("entitlement-row");
    expect(await axe(container)).toHaveNoViolations();
  });
});
