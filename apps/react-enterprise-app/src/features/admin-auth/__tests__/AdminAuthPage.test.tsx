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
  adminAuthReadinessHandler,
  adminGetErrorHandler,
} from "../../../msw";
import { AdminAuthPage } from "../AdminAuthPage";

async function openSessionTab() {
  await screen.findByTestId("auth-provider-mode");
  await userEvent.click(screen.getByRole("tab", { name: enGB.feature.admin.auth.tab.session }));
}

async function openMfaTab() {
  await screen.findByTestId("auth-provider-mode");
  await userEvent.click(screen.getByRole("tab", { name: enGB.feature.admin.auth.tab.mfa }));
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

  it("shows a retryable error when provider config cannot be read", async () => {
    server.use(
      sessionHandler("tenantAdmin"),
      adminGetErrorHandler("/api/auth/settings/providers", 500)
    );
    renderPage();
    await screen.findByTestId("admin-error-error");
  });

  it("has no accessibility violations", async () => {
    server.use(sessionHandler("tenantAdmin"), adminAuthProvidersHandler());
    const { container } = renderPage();
    await screen.findByTestId("auth-provider-mode");
    expect(await axe(container)).toHaveNoViolations();
  });

  // --- Session tab (ADR-0041): readiness-gated writable policy ---------------

  it("renders an editable Session form when the credential is configured", async () => {
    server.use(
      sessionHandler("tenantAdmin"),
      adminAuthProvidersHandler(),
      adminAuthReadinessHandler({ status: "configured" })
    );
    renderPage();
    await openSessionTab();
    expect(await screen.findByTestId("auth-session-form")).toBeInTheDocument();
    expect(screen.queryByTestId("auth-session-readiness")).not.toBeInTheDocument();
  });

  it("saving the Session policy announces success", async () => {
    server.use(
      sessionHandler("tenantAdmin"),
      adminAuthProvidersHandler(),
      adminAuthReadinessHandler({ status: "configured" })
    );
    renderPage();
    await openSessionTab();
    const input = await screen.findByTestId("auth-session-accessTokenLifespanSeconds");
    await userEvent.clear(input);
    await userEvent.type(input, "600");
    await userEvent.click(screen.getByTestId("auth-session-submit"));
    await waitFor(() =>
      expect(screen.getByTestId("auth-session-status")).toHaveTextContent(/saved/i)
    );
  });

  it("shows a readiness notice and no form when the credential is missing", async () => {
    server.use(
      sessionHandler("tenantAdmin"),
      adminAuthProvidersHandler(),
      adminAuthReadinessHandler({ status: "missing_credential" }),
      adminGetErrorHandler("/api/auth/settings/session", 503)
    );
    renderPage();
    await openSessionTab();
    expect(await screen.findByTestId("auth-session-readiness")).toHaveTextContent(
      enGB.feature.admin.auth.readiness.missing_credential
    );
    expect(screen.queryByTestId("auth-session-form")).not.toBeInTheDocument();
  });

  it("keeps the Session policy read-only for a user without write permission", async () => {
    server.use(
      sessionHandler("viewer"),
      adminAuthProvidersHandler(),
      adminAuthReadinessHandler({ status: "configured" })
    );
    renderPage();
    await openSessionTab();
    expect(await screen.findByTestId("auth-session-readonly")).toBeInTheDocument();
    expect(screen.queryByTestId("auth-session-form")).not.toBeInTheDocument();
  });

  it("Session form has no accessibility violations", async () => {
    server.use(
      sessionHandler("tenantAdmin"),
      adminAuthProvidersHandler(),
      adminAuthReadinessHandler({ status: "configured" })
    );
    const { container } = renderPage();
    await openSessionTab();
    await screen.findByTestId("auth-session-form");
    expect(await axe(container)).toHaveNoViolations();
  });

  // --- MFA tab (ADR-0042): readiness-gated writable required level ------------

  it("renders an editable MFA form when the credential is configured", async () => {
    server.use(
      sessionHandler("tenantAdmin"),
      adminAuthProvidersHandler(),
      adminAuthReadinessHandler({ status: "configured" })
    );
    renderPage();
    await openMfaTab();
    expect(await screen.findByTestId("auth-mfa-form")).toBeInTheDocument();
    expect(screen.getByTestId("auth-mfa-required")).toBeInTheDocument();
    expect(screen.queryByTestId("auth-mfa-readiness")).not.toBeInTheDocument();
  });

  it("saving the MFA policy announces success", async () => {
    server.use(
      sessionHandler("tenantAdmin"),
      adminAuthProvidersHandler(),
      adminAuthReadinessHandler({ status: "configured" })
    );
    renderPage();
    await openMfaTab();
    const trigger = within(await screen.findByTestId("auth-mfa-required")).getByRole("button");
    await userEvent.click(trigger);
    await userEvent.click(
      await screen.findByRole("option", {
        name: enGB.feature.admin.auth.mfa.requiredOption.required,
      })
    );
    await userEvent.click(screen.getByTestId("auth-mfa-submit"));
    await waitFor(() => expect(screen.getByTestId("auth-mfa-status")).toHaveTextContent(/saved/i));
  });

  it("shows a readiness notice and no MFA form when the credential is invalid", async () => {
    server.use(
      sessionHandler("tenantAdmin"),
      adminAuthProvidersHandler(),
      adminAuthReadinessHandler({ status: "invalid_credential" }),
      adminGetErrorHandler("/api/auth/settings/mfa", 502)
    );
    renderPage();
    await openMfaTab();
    expect(await screen.findByTestId("auth-mfa-readiness")).toHaveTextContent(
      enGB.feature.admin.auth.readiness.invalid_credential
    );
    expect(screen.queryByTestId("auth-mfa-form")).not.toBeInTheDocument();
  });

  it("keeps the MFA policy read-only for a user without write permission", async () => {
    server.use(
      sessionHandler("viewer"),
      adminAuthProvidersHandler(),
      adminAuthReadinessHandler({ status: "configured" })
    );
    renderPage();
    await openMfaTab();
    expect(await screen.findByTestId("auth-mfa-readonly")).toBeInTheDocument();
    expect(screen.queryByTestId("auth-mfa-form")).not.toBeInTheDocument();
  });

  it("MFA form has no accessibility violations", async () => {
    server.use(
      sessionHandler("tenantAdmin"),
      adminAuthProvidersHandler(),
      adminAuthReadinessHandler({ status: "configured" })
    );
    const { container } = renderPage();
    await openMfaTab();
    await screen.findByTestId("auth-mfa-form");
    expect(await axe(container)).toHaveNoViolations();
  });
});
