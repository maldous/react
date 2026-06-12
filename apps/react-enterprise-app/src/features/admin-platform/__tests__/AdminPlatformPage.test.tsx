import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { axe } from "vitest-axe";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nProvider, enGB } from "@platform/i18n-runtime";
import { PROOF_LADDER } from "@platform/contracts-admin";
import type { ReactNode } from "react";
import {
  server,
  sessionHandler,
  adminPlatformServicesHandler,
  adminGetErrorHandler,
  platformServicesReadinessSystemAdminFixture,
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

describe("AdminPlatformPage (ADR-0036 / ADR-ACT-0235)", () => {
  it("renders service status tiles and worker status for a tenant admin", async () => {
    server.use(sessionHandler("tenantAdmin"), adminPlatformServicesHandler());
    renderPage();

    const postgres = await screen.findByTestId("admin-platform-service-postgres");
    expect(postgres).toHaveTextContent(/postgres/i);
    expect(postgres).toHaveTextContent(/healthy/i);
    expect(postgres).toHaveTextContent(/data/i);
    // Postgres carries no console URL (it is not a console-bearing service).
    expect(within(postgres).queryByRole("link")).not.toBeInTheDocument();

    // Unreachable service renders honestly, without a console link.
    const wiremock = screen.getByTestId("admin-platform-service-wiremock");
    expect(wiremock).toHaveTextContent(/unreachable/i);
    expect(within(wiremock).queryByRole("link")).not.toBeInTheDocument();

    // Degraded is a distinct state (reachable but unhealthy).
    const sonarqube = screen.getByTestId("admin-platform-service-sonarqube");
    expect(sonarqube).toHaveTextContent(/degraded/i);

    // Worker row with idle status + in-memory note.
    const worker = screen.getByTestId("admin-platform-worker-webhook-delivery");
    expect(worker).toHaveTextContent(/idle/i);
    expect(worker).toHaveTextContent(/in-memory/i);
    expect(worker).toHaveTextContent(/never/i);
  });

  it("hides global-only console links from tenant admins (pgAdmin/MinIO/Grafana)", async () => {
    server.use(sessionHandler("tenantAdmin"), adminPlatformServicesHandler());
    renderPage();

    await screen.findByTestId("admin-platform-service-postgres");
    for (const key of ["pgadmin", "minio", "grafana", "mailpit", "clickhouse"]) {
      const row = screen.getByTestId(`admin-platform-service-${key}`);
      expect(within(row).queryByRole("link")).not.toBeInTheDocument();
      // The operator-only marker is shown instead of the link.
      expect(row).toHaveTextContent(/system operator only/i);
    }

    // The tenant-safe Keycloak console link IS shown.
    const keycloak = screen.getByTestId("admin-platform-service-keycloak");
    const kcLink = within(keycloak).getByRole("link", { name: /open console/i });
    expect(kcLink).toHaveAttribute("href", "http://localhost:8090/kc");
  });

  it("renders global-only console links for a system admin (Grafana)", async () => {
    server.use(
      sessionHandler("systemAdmin"),
      adminPlatformServicesHandler(platformServicesReadinessSystemAdminFixture)
    );
    renderPage();

    const grafana = await screen.findByTestId("admin-platform-service-grafana");
    const link = within(grafana).getByRole("link", { name: /open console/i });
    expect(link).toHaveAttribute("href", "http://localhost:3200");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noreferrer");

    const pgadmin = screen.getByTestId("admin-platform-service-pgadmin");
    expect(within(pgadmin).getByRole("link", { name: /open console/i })).toHaveAttribute(
      "href",
      "http://localhost:5050/pgadmin"
    );

    // not_exposed stays unlinked even for system-admin (ADR-ACT-0233: WireMock).
    const wiremock = screen.getByTestId("admin-platform-service-wiremock");
    expect(within(wiremock).queryByRole("link")).not.toBeInTheDocument();
  });

  it("renders the proof-ladder index from the shared registry (incl. proof:backup-local)", async () => {
    server.use(sessionHandler("tenantAdmin"), adminPlatformServicesHandler());
    renderPage();

    const proofs = await screen.findByTestId("admin-platform-proofs");
    expect(within(proofs).getByText("proof:platform-services")).toBeInTheDocument();
    expect(within(proofs).getByText("proof:backup-local")).toBeInTheDocument();
    // Every registry entry renders with a local-only badge each.
    expect(within(proofs).getAllByText(/local-only/i)).toHaveLength(PROOF_LADDER.length);
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
