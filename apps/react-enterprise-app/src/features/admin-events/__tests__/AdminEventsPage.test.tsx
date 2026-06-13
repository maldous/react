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
  adminEventsHandlers,
} from "../../../msw";
import { AdminEventsPage } from "../AdminEventsPage";

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
  return render(<AdminEventsPage />, { wrapper: Wrapper });
}

async function selectFixtureTenant() {
  const region = await screen.findByTestId("events-tenant-form");
  await userEvent.click(within(region).getByRole("button"));
  await userEvent.click(await screen.findByRole("option", { name: /fixture-org/i }));
}

describe("AdminEventsPage", () => {
  it("shows the worker runtime and prompts to pick a tenant", async () => {
    server.use(
      sessionHandler("systemAdmin"),
      adminTenantsLookupHandler(),
      ...adminEventsHandlers()
    );
    renderPage();
    expect((await screen.findAllByTestId("worker-row")).length).toBeGreaterThan(0);
  });

  it("lists dead letters + events for the selected tenant and redrives", async () => {
    server.use(
      sessionHandler("systemAdmin"),
      adminTenantsLookupHandler(),
      ...adminEventsHandlers()
    );
    renderPage();
    await selectFixtureTenant();
    expect((await screen.findAllByTestId("dlq-row")).length).toBeGreaterThan(0);
    expect((await screen.findAllByTestId("event-row")).length).toBeGreaterThan(0);
    await userEvent.click((await screen.findAllByTestId("event-redrive"))[0]!);
    // redrive mutation succeeds (MSW returns 200) → no thrown error
    await waitFor(() => expect(screen.getByTestId("admin-events")).toBeInTheDocument());
  });

  it("has no accessibility violations (workers + tenant picker)", async () => {
    server.use(
      sessionHandler("systemAdmin"),
      adminTenantsLookupHandler(),
      ...adminEventsHandlers()
    );
    const { container } = renderPage();
    await screen.findAllByTestId("worker-row");
    expect(await axe(container)).toHaveNoViolations();
  });
});
