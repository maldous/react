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
  adminDomainsListHandler,
  adminDomainsReadinessHandler,
  adminDomainsCreateHandler,
  adminDomainsVerifyHandler,
  adminDomainsRemoveHandler,
} from "../../../msw";
import { AdminDomainsPage } from "../AdminDomainsPage";

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
  return render(<AdminDomainsPage />, { wrapper: Wrapper });
}

describe("AdminDomainsPage (ADR-0048)", () => {
  it("renders the domain list and readiness banner", async () => {
    server.use(
      sessionHandler("tenantAdmin"),
      adminDomainsListHandler(),
      adminDomainsReadinessHandler()
    );
    renderPage();
    expect(await screen.findByTestId("admin-domains-table")).toBeInTheDocument();
    // The readiness banner renders the localised message for the fixture status (pending_verification).
    expect(await screen.findByTestId("admin-domains-readiness-text")).not.toBeEmptyDOMElement();
    expect(screen.getByTestId("admin-domains-readiness-badge")).toHaveTextContent(
      "pending_verification"
    );
    expect(screen.getByTestId("admin-domains-domain-app.example.com")).toBeInTheDocument();
  });

  it("adds a domain and shows the TXT record then announces success", async () => {
    server.use(
      sessionHandler("tenantAdmin"),
      adminDomainsListHandler({ domains: [] }),
      adminDomainsReadinessHandler(),
      adminDomainsCreateHandler()
    );
    renderPage();
    await screen.findByTestId("admin-domains-add-form");
    const input = screen.getByTestId("admin-domains-domain-input");
    await userEvent.type(input, "custom.example.com");
    await userEvent.click(screen.getByTestId("admin-domains-add-button"));
    await waitFor(() =>
      expect(screen.getByTestId("admin-domains-added")).toHaveTextContent(/added/i)
    );
    expect(await screen.findByTestId("admin-domains-txt-panel")).toBeInTheDocument();
    expect(screen.getByTestId("admin-domains-txt-name")).toHaveTextContent(
      "_platform-verify.custom.example.com"
    );
    expect(screen.getByTestId("admin-domains-txt-value")).toHaveTextContent("verify-token-abc123");
  });

  it("verifies a domain and announces success", async () => {
    server.use(
      sessionHandler("tenantAdmin"),
      adminDomainsListHandler(),
      adminDomainsReadinessHandler(),
      adminDomainsVerifyHandler()
    );
    renderPage();
    const verifyBtn = await screen.findByTestId("admin-domains-verify-app.example.com");
    await userEvent.click(verifyBtn);
    await waitFor(() =>
      expect(
        screen.getByTestId("admin-domains-verify-announce-app.example.com")
      ).not.toBeEmptyDOMElement()
    );
  });

  it("removes a domain and announces success", async () => {
    server.use(
      sessionHandler("tenantAdmin"),
      adminDomainsListHandler(),
      adminDomainsReadinessHandler(),
      adminDomainsRemoveHandler()
    );
    renderPage();
    const removeBtn = await screen.findByTestId("admin-domains-remove-app.example.com");
    await userEvent.click(removeBtn);
    await waitFor(() =>
      expect(screen.getByTestId("admin-domains-remove-announce-app.example.com")).toHaveTextContent(
        /removed/i
      )
    );
  });

  it("is read-only without write permission (viewer has no tenant.domains.write)", async () => {
    server.use(sessionHandler("viewer"), adminDomainsListHandler(), adminDomainsReadinessHandler());
    renderPage();
    await screen.findByTestId("admin-domains");
    // No add form rendered when canWrite is false
    expect(screen.queryByTestId("admin-domains-add-form")).not.toBeInTheDocument();
    // No verify or remove buttons
    expect(screen.queryByTestId("admin-domains-verify-app.example.com")).not.toBeInTheDocument();
    expect(screen.queryByTestId("admin-domains-remove-app.example.com")).not.toBeInTheDocument();
  });

  it("has no accessibility violations", async () => {
    server.use(
      sessionHandler("tenantAdmin"),
      adminDomainsListHandler(),
      adminDomainsReadinessHandler()
    );
    const { container } = renderPage();
    await screen.findByTestId("admin-domains-table");
    expect(await axe(container)).toHaveNoViolations();
  });
});
