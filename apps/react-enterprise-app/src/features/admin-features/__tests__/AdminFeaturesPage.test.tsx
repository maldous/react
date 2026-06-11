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
  adminFeaturesHandler,
  adminGetErrorHandler,
  featuresFixture,
} from "../../../msw";
import { AdminFeaturesPage } from "../AdminFeaturesPage";

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
  return render(<AdminFeaturesPage />, { wrapper: Wrapper });
}

describe("AdminFeaturesPage", () => {
  it("lists feature toggles for a tenant admin", async () => {
    server.use(sessionHandler("tenantAdmin"), adminFeaturesHandler());
    renderPage();
    await screen.findByTestId("feature-row-analytics");
    expect(screen.getByTestId("feature-toggle-analytics")).toBeInTheDocument();
    expect(screen.getByTestId("feature-row-webhooks")).toBeInTheDocument();
  });

  it("toggling a feature announces success", async () => {
    server.use(sessionHandler("tenantAdmin"), adminFeaturesHandler());
    renderPage();
    const toggle = within(await screen.findByTestId("feature-toggle-advanced_auth")).getByRole(
      "switch"
    );
    await userEvent.click(toggle);
    await waitFor(() =>
      expect(screen.getByTestId("features-status")).toHaveTextContent(/feature updated/i)
    );
  });

  it("disables toggles for a user without update permission", async () => {
    server.use(sessionHandler("viewer"), adminFeaturesHandler());
    renderPage();
    const toggle = within(await screen.findByTestId("feature-toggle-analytics")).getByRole(
      "switch"
    );
    expect(toggle).toBeDisabled();
  });

  it("renders a retryable error state when features fail to load", async () => {
    server.use(sessionHandler("tenantAdmin"), adminGetErrorHandler("/api/org/features", 500));
    renderPage();
    await screen.findByTestId("admin-error-error");
  });

  it("has no accessibility violations", async () => {
    server.use(sessionHandler("tenantAdmin"), adminFeaturesHandler());
    const { container } = renderPage();
    await screen.findByTestId("feature-row-analytics");
    expect(await axe(container)).toHaveNoViolations();
  });

  it("uses the canonical feature keys from the fixture", () => {
    expect(featuresFixture.features.map((f) => f.key)).toContain("analytics");
  });
});
