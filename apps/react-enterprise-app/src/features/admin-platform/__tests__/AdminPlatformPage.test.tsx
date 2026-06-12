import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { axe } from "vitest-axe";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nProvider, enGB } from "@platform/i18n-runtime";
import type { ReactNode } from "react";
import {
  server,
  sessionHandler,
  adminPlatformServicesHandler,
  adminGetErrorHandler,
} from "../../../msw";
import { AdminPlatformPage } from "../AdminPlatformPage";

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
  return render(<AdminPlatformPage />, { wrapper: Wrapper });
}

describe("AdminPlatformPage (ADR-0036)", () => {
  it("renders services with a console link and worker status", async () => {
    server.use(sessionHandler("tenantAdmin"), adminPlatformServicesHandler());
    renderPage();

    const postgres = await screen.findByTestId("admin-platform-service-postgres");
    expect(postgres).toHaveTextContent(/postgres/i);
    expect(postgres).toHaveTextContent(/healthy/i);
    expect(postgres).toHaveTextContent(/data/i);
    // Console link comes straight from the API consoleUrl.
    const link = within(postgres).getByRole("link", { name: /open console/i });
    expect(link).toHaveAttribute("href", "http://localhost:3200");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noreferrer");

    // Unreachable service has no console link.
    const redis = screen.getByTestId("admin-platform-service-redis");
    expect(redis).toHaveTextContent(/unreachable/i);
    expect(within(redis).queryByRole("link")).not.toBeInTheDocument();

    // Worker row with idle status + in-memory note.
    const worker = screen.getByTestId("admin-platform-worker-webhook-delivery");
    expect(worker).toHaveTextContent(/idle/i);
    expect(worker).toHaveTextContent(/in-memory/i);
    expect(worker).toHaveTextContent(/never/i);
  });

  it("renders the static proof-ladder index", async () => {
    server.use(sessionHandler("tenantAdmin"), adminPlatformServicesHandler());
    renderPage();

    const proofs = await screen.findByTestId("admin-platform-proofs");
    expect(within(proofs).getByText("proof:platform-services")).toBeInTheDocument();
    expect(within(proofs).getByText("proof:auth-oidc-enterprise")).toBeInTheDocument();
    // All 10 proofs render with a local-only badge each.
    expect(within(proofs).getAllByText(/local-only/i)).toHaveLength(10);
  });

  it("renders the error state when the query fails", async () => {
    server.use(
      sessionHandler("tenantAdmin"),
      adminGetErrorHandler("/api/org/platform/services/readiness", 503)
    );
    renderPage();
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByTestId("admin-platform")).not.toBeInTheDocument();
  });

  it("has no accessibility violations", async () => {
    server.use(sessionHandler("tenantAdmin"), adminPlatformServicesHandler());
    const { container } = renderPage();
    await screen.findByTestId("admin-platform");
    expect(await axe(container)).toHaveNoViolations();
  });
});
