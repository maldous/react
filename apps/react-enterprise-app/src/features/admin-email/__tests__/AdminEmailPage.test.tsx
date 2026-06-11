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
  adminEmailSenderHandler,
  adminEmailSenderUpdateHandler,
  adminEmailSenderTestHandler,
} from "../../../msw";
import { AdminEmailPage } from "../AdminEmailPage";

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
  return render(<AdminEmailPage />, { wrapper: Wrapper });
}

const smtpFixture = {
  provider: "smtp",
  fromName: "Acme",
  fromEmail: "noreply@acme.test",
  replyToEmail: "",
  enabled: true,
  smtpHost: "smtp.acme.test",
  smtpPort: 587,
  smtpSecure: true,
  smtpUsername: "acme",
  hasCredential: true,
  updatedAt: "2026-06-12T00:00:00Z",
  readiness: "unknown",
};

describe("AdminEmailPage (ADR-0047)", () => {
  it("renders the sender settings and readiness banner", async () => {
    server.use(sessionHandler("tenantAdmin"), adminEmailSenderHandler());
    renderPage();
    expect(await screen.findByTestId("admin-email-form")).toBeInTheDocument();
    expect(screen.getByTestId("admin-email-field-fromEmail")).toHaveValue("noreply@acme.test");
    expect(screen.getByTestId("admin-email-readiness-text")).toHaveTextContent(
      /configured|verified/i
    );
  });

  it("saves the sender identity and announces success", async () => {
    server.use(
      sessionHandler("tenantAdmin"),
      adminEmailSenderHandler(),
      adminEmailSenderUpdateHandler()
    );
    renderPage();
    const fromName = await screen.findByTestId("admin-email-field-fromName");
    await userEvent.clear(fromName);
    await userEvent.type(fromName, "Acme Corp");
    await userEvent.click(screen.getByTestId("admin-email-submit"));
    await waitFor(() =>
      expect(screen.getByTestId("admin-email-saved")).toHaveTextContent(/saved/i)
    );
  });

  it("never prefills the secret field when editing an smtp sender", async () => {
    server.use(sessionHandler("tenantAdmin"), adminEmailSenderHandler(smtpFixture));
    renderPage();
    expect(await screen.findByTestId("admin-email-field-smtpPassword")).toHaveValue("");
  });

  it("sends a test email and announces the result", async () => {
    server.use(
      sessionHandler("tenantAdmin"),
      adminEmailSenderHandler(),
      adminEmailSenderTestHandler()
    );
    renderPage();
    const to = await screen.findByTestId("admin-email-test-to");
    await userEvent.type(to, "dest@acme.test");
    await userEvent.click(screen.getByTestId("admin-email-test-submit"));
    await waitFor(() =>
      expect(screen.getByTestId("admin-email-test-result")).toHaveTextContent(/sent/i)
    );
  });

  it("is read-only without write permission", async () => {
    server.use(sessionHandler("viewer"), adminEmailSenderHandler());
    renderPage();
    await screen.findByTestId("admin-email-form");
    expect(screen.queryByTestId("admin-email-submit")).not.toBeInTheDocument();
    expect(screen.queryByTestId("admin-email-test-submit")).not.toBeInTheDocument();
  });

  it("has no accessibility violations", async () => {
    server.use(sessionHandler("tenantAdmin"), adminEmailSenderHandler());
    const { container } = renderPage();
    await screen.findByTestId("admin-email-form");
    expect(await axe(container)).toHaveNoViolations();
  });
});
