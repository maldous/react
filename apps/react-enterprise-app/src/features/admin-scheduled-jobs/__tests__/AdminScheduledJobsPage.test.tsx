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
  adminScheduledJobsHandlers,
} from "../../../msw";
import { AdminScheduledJobsPage } from "../AdminScheduledJobsPage";

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
  return render(<AdminScheduledJobsPage />, { wrapper: Wrapper });
}

async function selectFixtureTenant() {
  const region = await screen.findByTestId("jobs-tenant-form");
  await userEvent.click(within(region).getByRole("button"));
  await userEvent.click(await screen.findByRole("option", { name: /fixture-org/i }));
}

describe("AdminScheduledJobsPage", () => {
  it("lists scheduled jobs for a tenant and runs one", async () => {
    server.use(
      sessionHandler("systemAdmin"),
      adminTenantsLookupHandler(),
      ...adminScheduledJobsHandlers()
    );
    renderPage();
    await selectFixtureTenant();
    expect((await screen.findAllByTestId("job-row")).length).toBeGreaterThan(0);
    await userEvent.click((await screen.findAllByTestId("job-run"))[0]!);
    await waitFor(() => expect(screen.getByTestId("admin-scheduled-jobs")).toBeInTheDocument());
  });

  it("pauses/resumes a job", async () => {
    server.use(
      sessionHandler("systemAdmin"),
      adminTenantsLookupHandler(),
      ...adminScheduledJobsHandlers()
    );
    renderPage();
    await selectFixtureTenant();
    await userEvent.click((await screen.findAllByTestId("job-toggle"))[0]!);
    await waitFor(() => expect(screen.getByTestId("admin-scheduled-jobs")).toBeInTheDocument());
  });

  it("has no accessibility violations", async () => {
    server.use(
      sessionHandler("systemAdmin"),
      adminTenantsLookupHandler(),
      ...adminScheduledJobsHandlers()
    );
    const { container } = renderPage();
    await selectFixtureTenant();
    await screen.findAllByTestId("job-row");
    expect(await axe(container)).toHaveNoViolations();
  });
});
