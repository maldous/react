import { describe, it, expect } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nProvider, enGB } from "@platform/i18n-runtime";
import type { ReactNode } from "react";
import { server, sessionHandler, adminConfigHandler, adminGetErrorHandler } from "../../../msw";
import { AdminConfigPage } from "../AdminConfigPage";

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
  return render(<AdminConfigPage />, { wrapper: Wrapper });
}

describe("AdminConfigPage", () => {
  it("renders config grouped by category with source badges", async () => {
    server.use(sessionHandler("tenantAdmin"), adminConfigHandler());
    renderPage();
    await screen.findByTestId("config-category-features");
    expect(screen.getByTestId("config-category-branding")).toBeInTheDocument();
    expect(screen.getByTestId("config-row-branding.app_name")).toBeInTheDocument();
    // Contextual audit panel (ADR-0040) is present on the config page.
    expect(await screen.findByTestId("config-audit-list")).toBeInTheDocument();
    expect(screen.getByTestId("config-source-features.analytics")).toHaveTextContent(/overridden/i);
    expect(screen.getByTestId("config-source-branding.app_name")).toHaveTextContent(/default/i);
  });

  it("toggles a boolean config value", async () => {
    server.use(sessionHandler("tenantAdmin"), adminConfigHandler());
    renderPage();
    const sw = within(await screen.findByTestId("config-value-features.analytics")).getByRole(
      "switch"
    );
    await userEvent.click(sw);
    await waitFor(() =>
      expect(screen.getByTestId("config-status")).toHaveTextContent(/configuration saved/i)
    );
  });

  it("saves a string config value", async () => {
    server.use(sessionHandler("tenantAdmin"), adminConfigHandler());
    renderPage();
    const input = await screen.findByTestId("config-value-branding.app_name");
    await userEvent.clear(input);
    await userEvent.type(input, "Acme");
    await userEvent.click(screen.getByTestId("config-save-branding.app_name"));
    await waitFor(() =>
      expect(screen.getByTestId("config-status")).toHaveTextContent(/configuration saved/i)
    );
  });

  it("resets an overridden value (reset only shown for overrides)", async () => {
    server.use(sessionHandler("tenantAdmin"), adminConfigHandler());
    renderPage();
    const reset = await screen.findByTestId("config-reset-features.analytics");
    // a default-source value has no reset control
    expect(screen.queryByTestId("config-reset-branding.app_name")).not.toBeInTheDocument();
    await userEvent.click(reset);
    await waitFor(() =>
      expect(screen.getByTestId("config-status")).toHaveTextContent(/configuration saved/i)
    );
  });

  it("is read-only for a user without write permission", async () => {
    server.use(sessionHandler("viewer"), adminConfigHandler());
    renderPage();
    await screen.findByTestId("config-row-branding.app_name");
    expect(screen.queryByTestId("config-save-branding.app_name")).not.toBeInTheDocument();
    expect(screen.queryByTestId("config-reset-features.analytics")).not.toBeInTheDocument();
    const sw = within(screen.getByTestId("config-value-features.analytics")).getByRole("switch");
    expect(sw).toBeDisabled();
  });

  it("renders a retryable error when config cannot be read", async () => {
    server.use(sessionHandler("tenantAdmin"), adminGetErrorHandler("/api/org/config", 500));
    renderPage();
    await screen.findByTestId("admin-error-error");
  });

  it("has no accessibility violations", async () => {
    server.use(sessionHandler("tenantAdmin"), adminConfigHandler());
    const { container } = renderPage();
    await screen.findByTestId("config-category-features");
    expect(await axe(container)).toHaveNoViolations();
  });
});
