import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nProvider, enGB } from "@platform/i18n-runtime";
import type { ReactNode } from "react";
import { server, sessionHandler, adminAuditHandler, adminGetErrorHandler } from "../../../msw";
import { AuditTrailPanel } from "../AuditTrailPanel";

function renderPanel() {
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
  return render(
    <AuditTrailPanel resource="member" heading="Recent activity" testId="audit-panel" />,
    { wrapper: Wrapper }
  );
}

describe("AuditTrailPanel", () => {
  it("renders recent audit events (action + actor + time)", async () => {
    server.use(sessionHandler("tenantAdmin"), adminAuditHandler());
    renderPanel();
    const list = await screen.findByTestId("audit-panel-list");
    expect(list).toHaveTextContent("member.status_changed");
    expect(list).toHaveTextContent(/by /i);
  });

  it("shows an empty state when there is no activity", async () => {
    server.use(sessionHandler("tenantAdmin"), adminAuditHandler({ events: [] }));
    renderPanel();
    await screen.findByText(enGB.feature.admin.audit.empty);
  });

  it("renders a retryable error when the audit query fails", async () => {
    server.use(sessionHandler("tenantAdmin"), adminGetErrorHandler("/api/org/audit", 500));
    renderPanel();
    await screen.findByTestId("admin-error-error");
  });

  it("renders the forbidden state on 403", async () => {
    server.use(sessionHandler("tenantAdmin"), adminGetErrorHandler("/api/org/audit", 403));
    renderPanel();
    await screen.findByTestId("admin-error-forbidden");
  });

  it("has no accessibility violations", async () => {
    server.use(sessionHandler("tenantAdmin"), adminAuditHandler());
    const { container } = renderPanel();
    await screen.findByTestId("audit-panel-list");
    expect(await axe(container)).toHaveNoViolations();
  });
});
