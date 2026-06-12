import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nProvider, enGB } from "@platform/i18n-runtime";
import type { ReactNode } from "react";
import {
  server,
  sessionHandler,
  adminObservabilityReadinessHandler,
  adminGetErrorHandler,
} from "../../../msw";
import { AdminObservabilityPage } from "../AdminObservabilityPage";

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
  return render(<AdminObservabilityPage />, { wrapper: Wrapper });
}

describe("AdminObservabilityPage (ADR-0050)", () => {
  it("renders readiness banner, signal rows, and high-cardinality guard", async () => {
    server.use(sessionHandler("tenantAdmin"), adminObservabilityReadinessHandler());
    renderPage();
    expect(await screen.findByTestId("admin-observability-readiness-badge")).toHaveTextContent(
      "configured"
    );
    expect(screen.getByTestId("admin-observability-readiness-text")).not.toBeEmptyDOMElement();
    expect(screen.getByTestId("admin-observability-log-ingestion")).not.toBeEmptyDOMElement();
    expect(screen.getByTestId("admin-observability-tenant-query")).not.toBeEmptyDOMElement();
    expect(screen.getByTestId("admin-observability-trace")).not.toBeEmptyDOMElement();
    expect(screen.getByTestId("admin-observability-guard")).toHaveTextContent(/intact/i);
    // New ADR-ACT-0224 signal rows
    expect(screen.getByTestId("admin-observability-signal-metrics")).not.toBeEmptyDOMElement();
    expect(
      screen.getByTestId("admin-observability-signal-otel-collector")
    ).not.toBeEmptyDOMElement();
    expect(screen.getByTestId("admin-observability-signal-dashboards")).not.toBeEmptyDOMElement();
    expect(
      screen.getByTestId("admin-observability-signal-error-capture")
    ).not.toBeEmptyDOMElement();
  });

  it("renders new signal rows with correct translated values", async () => {
    server.use(sessionHandler("tenantAdmin"), adminObservabilityReadinessHandler());
    renderPage();
    await screen.findByTestId("admin-observability-readiness-badge");
    // dashboards: "ok" → "OK" (or similar)
    expect(screen.getByTestId("admin-observability-signal-dashboards")).toHaveTextContent(/ok/i);
    // metrics: "not_applicable" → "Not applicable"
    expect(screen.getByTestId("admin-observability-signal-metrics")).toHaveTextContent(
      /not applicable/i
    );
    // errorCapture: "not_configured" → "Not configured"
    expect(screen.getByTestId("admin-observability-signal-error-capture")).toHaveTextContent(
      /not configured/i
    );
  });

  it("renders degraded readiness status when the backend reports degraded", async () => {
    server.use(
      sessionHandler("tenantAdmin"),
      adminObservabilityReadinessHandler({
        status: "degraded",
        logIngestion: "ok",
        tenantScopedQuery: "unreachable",
        traceCorrelation: "not_applicable",
        highCardinalityGuard: false,
      })
    );
    renderPage();
    expect(await screen.findByTestId("admin-observability-readiness-badge")).toHaveTextContent(
      "degraded"
    );
    expect(screen.getByTestId("admin-observability-guard")).toHaveTextContent(/regressed/i);
  });

  it("renders the error state when the query fails", async () => {
    server.use(
      sessionHandler("tenantAdmin"),
      adminGetErrorHandler("/api/org/observability/readiness", 503)
    );
    renderPage();
    // AdminQueryError renders when isError is true — just confirm the page root is absent.
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByTestId("admin-observability")).not.toBeInTheDocument();
  });

  it("has no accessibility violations", async () => {
    server.use(sessionHandler("tenantAdmin"), adminObservabilityReadinessHandler());
    const { container } = renderPage();
    await screen.findByTestId("admin-observability");
    expect(await axe(container)).toHaveNoViolations();
  });
});
