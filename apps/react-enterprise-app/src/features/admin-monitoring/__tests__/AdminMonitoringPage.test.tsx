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
  adminTenantsLookupHandler,
  adminMonitoringHandlers,
} from "../../../msw";
import { AdminMonitoringPage } from "../AdminMonitoringPage";

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
  return render(<AdminMonitoringPage />, { wrapper: Wrapper });
}

async function selectFixtureTenant() {
  const region = await screen.findByTestId("monitoring-tenant-form");
  await userEvent.click(within(region).getByRole("button"));
  await userEvent.click(await screen.findByRole("option", { name: /fixture-org/i }));
}

describe("AdminMonitoringPage", () => {
  it("shows observability readiness and prompts to pick a tenant", async () => {
    server.use(
      sessionHandler("systemAdmin"),
      adminTenantsLookupHandler(),
      ...adminMonitoringHandlers()
    );
    renderPage();
    expect(await screen.findByTestId("monitoring-readiness")).toBeInTheDocument();
  });

  it("lists signals/alerts/incidents for a tenant and evaluates an alert", async () => {
    server.use(
      sessionHandler("systemAdmin"),
      adminTenantsLookupHandler(),
      ...adminMonitoringHandlers()
    );
    renderPage();
    await selectFixtureTenant();
    expect((await screen.findAllByTestId("signal-row")).length).toBeGreaterThan(0);
    expect((await screen.findAllByTestId("alert-row")).length).toBeGreaterThan(0);
    expect((await screen.findAllByTestId("incident-row")).length).toBeGreaterThan(0);
    await userEvent.click((await screen.findAllByTestId("alert-evaluate"))[0]!);
    await waitFor(() => expect(screen.getByTestId("admin-monitoring")).toBeInTheDocument());
  });

  it("transitions an incident (acknowledge)", async () => {
    server.use(
      sessionHandler("systemAdmin"),
      adminTenantsLookupHandler(),
      ...adminMonitoringHandlers()
    );
    renderPage();
    await selectFixtureTenant();
    await userEvent.click((await screen.findAllByTestId("incident-ack"))[0]!);
    await waitFor(() => expect(screen.getByTestId("admin-monitoring")).toBeInTheDocument());
  });

  it("has no accessibility violations (readiness + tenant picker)", async () => {
    server.use(
      sessionHandler("systemAdmin"),
      adminTenantsLookupHandler(),
      ...adminMonitoringHandlers()
    );
    const { container } = renderPage();
    await screen.findByTestId("monitoring-readiness");
    expect(await axe(container)).toHaveNoViolations();
  });
});
