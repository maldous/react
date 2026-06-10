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
  adminAuthProvidersHandler,
  adminIdpsHandler,
  adminGetErrorHandler,
} from "../../../msw";
import { AdminAuthPage } from "../AdminAuthPage";

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
  return render(<AdminAuthPage />, { wrapper: Wrapper });
}

describe("AdminAuthPage", () => {
  it("renders the per-tenant provider config (mode + provider toggles)", async () => {
    server.use(sessionHandler("tenantAdmin"), adminAuthProvidersHandler());
    renderPage();
    expect(await screen.findByTestId("auth-provider-mode")).toBeInTheDocument();
    expect(screen.getByTestId("auth-provider-google")).toBeInTheDocument();
    expect(screen.getByTestId("auth-provider-azure")).toBeInTheDocument();
  });

  it("toggling a provider announces success", async () => {
    server.use(sessionHandler("tenantAdmin"), adminAuthProvidersHandler());
    renderPage();
    const sw = within(await screen.findByTestId("auth-provider-google")).getByRole("switch");
    await userEvent.click(sw);
    await waitFor(() =>
      expect(screen.getByTestId("auth-providers-status")).toHaveTextContent(/saved/i)
    );
  });

  it("disables provider controls for a user without write permission", async () => {
    server.use(sessionHandler("viewer"), adminAuthProvidersHandler());
    renderPage();
    const sw = within(await screen.findByTestId("auth-provider-google")).getByRole("switch");
    expect(sw).toBeDisabled();
  });

  it("shows the identity providers tab list", async () => {
    server.use(sessionHandler("tenantAdmin"), adminAuthProvidersHandler(), adminIdpsHandler());
    renderPage();
    await screen.findByTestId("auth-provider-mode");
    await userEvent.click(screen.getByRole("tab", { name: enGB.feature.admin.auth.tab.idps }));
    expect(await screen.findByText("Mock Google", {}, { timeout: 3000 })).toBeInTheDocument();
  });

  it("shows an unavailable state when provider config cannot be read", async () => {
    server.use(
      sessionHandler("tenantAdmin"),
      adminGetErrorHandler("/api/auth/settings/providers", 503)
    );
    renderPage();
    await screen.findByText(enGB.feature.admin.auth.providers.unavailable);
  });

  it("has no accessibility violations", async () => {
    server.use(sessionHandler("tenantAdmin"), adminAuthProvidersHandler());
    const { container } = renderPage();
    await screen.findByTestId("auth-provider-mode");
    expect(await axe(container)).toHaveNoViolations();
  });
});
