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
  adminWebhooksListHandler,
  adminWebhooksReadinessHandler,
  adminWebhooksCreateHandler,
  adminWebhooksTestHandler,
  adminWebhooksRotateHandler,
  adminWebhooksDeleteHandler,
  adminWebhooksUpdateHandler,
  adminWebhooksDeliveriesHandler,
} from "../../../msw";
import { AdminWebhooksPage } from "../AdminWebhooksPage";

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
  return render(<AdminWebhooksPage />, { wrapper: Wrapper });
}

const writeHandlers = [
  adminWebhooksCreateHandler(),
  adminWebhooksTestHandler(),
  adminWebhooksRotateHandler(),
  adminWebhooksDeleteHandler(),
  adminWebhooksUpdateHandler(),
  adminWebhooksDeliveriesHandler(),
];

describe("AdminWebhooksPage (ADR-0051)", () => {
  it("renders the subscription list and readiness banner", async () => {
    server.use(
      sessionHandler("tenantAdmin"),
      adminWebhooksListHandler(),
      adminWebhooksReadinessHandler()
    );
    renderPage();
    expect(await screen.findByTestId("admin-webhooks-table")).toBeInTheDocument();
    expect(await screen.findByTestId("admin-webhooks-readiness-text")).not.toBeEmptyDOMElement();
    expect(screen.getByTestId("admin-webhooks-readiness-badge")).toHaveTextContent("configured");
    expect(screen.getByTestId("admin-webhooks-row-wh-1")).toBeInTheDocument();
  });

  it("creates a webhook and shows the signing secret once, then announces success", async () => {
    server.use(
      sessionHandler("tenantAdmin"),
      adminWebhooksListHandler({ subscriptions: [] }),
      adminWebhooksReadinessHandler(),
      ...writeHandlers
    );
    renderPage();
    await screen.findByTestId("admin-webhooks-add-form");
    await userEvent.type(
      screen.getByTestId("admin-webhooks-url-input"),
      "https://example.com/hooks/platform"
    );
    await userEvent.click(screen.getByRole("checkbox", { name: "platform.test" }));
    await userEvent.click(screen.getByTestId("admin-webhooks-add-button"));
    await waitFor(() =>
      expect(screen.getByTestId("admin-webhooks-added")).toHaveTextContent(/created/i)
    );
    // the secret is revealed exactly once, in the dismissible panel
    expect(await screen.findByTestId("admin-webhooks-secret-panel")).toBeInTheDocument();
    expect(screen.getByTestId("admin-webhooks-secret-value")).toHaveTextContent("whsec_msw");
  });

  it("sends a test event and announces the result", async () => {
    server.use(
      sessionHandler("tenantAdmin"),
      adminWebhooksListHandler(),
      adminWebhooksReadinessHandler(),
      ...writeHandlers
    );
    renderPage();
    const testBtn = await screen.findByTestId("admin-webhooks-test-wh-1");
    await userEvent.click(testBtn);
    await waitFor(() =>
      expect(screen.getByTestId("admin-webhooks-tested-announce-wh-1")).not.toBeEmptyDOMElement()
    );
  });

  it("is read-only without write permission (viewer has no tenant.webhooks.write)", async () => {
    server.use(
      sessionHandler("viewer"),
      adminWebhooksListHandler(),
      adminWebhooksReadinessHandler()
    );
    renderPage();
    await screen.findByTestId("admin-webhooks");
    expect(screen.queryByTestId("admin-webhooks-add-form")).not.toBeInTheDocument();
    expect(screen.queryByTestId("admin-webhooks-test-wh-1")).not.toBeInTheDocument();
    expect(screen.queryByTestId("admin-webhooks-remove-wh-1")).not.toBeInTheDocument();
  });

  it("has no accessibility violations", async () => {
    server.use(
      sessionHandler("tenantAdmin"),
      adminWebhooksListHandler(),
      adminWebhooksReadinessHandler()
    );
    const { container } = renderPage();
    await screen.findByTestId("admin-webhooks-table");
    expect(await axe(container)).toHaveNoViolations();
  });
});
