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
  adminTenantsLookupHandler,
  adminAccountHandlers,
} from "../../../msw";
import { AdminAccountPage } from "../AdminAccountPage";

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
  return render(<AdminAccountPage />, { wrapper: Wrapper });
}

describe("AdminAccountPage", () => {
  it("shows the user's profile + preferences and saves the profile", async () => {
    server.use(sessionHandler("tenantAdmin"), ...adminAccountHandlers());
    renderPage();
    const name = await screen.findByTestId("profile-display-name");
    await waitFor(() => expect((name as HTMLInputElement).value).toBe("Ada Lovelace"));
    await userEvent.clear(name);
    await userEvent.type(name, "Grace Hopper");
    await userEvent.click(screen.getByTestId("profile-save"));
    expect(await screen.findByTestId("profile-saved")).toBeInTheDocument();
    expect(await screen.findByTestId("preferences-form")).toBeInTheDocument();
    // Tenant user: no operator notifications section.
    expect(screen.queryByTestId("notification-test-form")).not.toBeInTheDocument();
  });

  it("saves notification preferences", async () => {
    server.use(sessionHandler("tenantAdmin"), ...adminAccountHandlers());
    renderPage();
    await screen.findByTestId("preferences-form");
    await userEvent.click(screen.getByTestId("preferences-save"));
    expect(await screen.findByTestId("preferences-saved")).toBeInTheDocument();
  });

  it("shows the operator notifications section for a system operator", async () => {
    server.use(
      sessionHandler("systemAdmin"),
      adminTenantsLookupHandler(),
      ...adminAccountHandlers()
    );
    renderPage();
    expect(await screen.findByTestId("notification-readiness")).toBeInTheDocument();
    expect(await screen.findByTestId("notification-test-form")).toBeInTheDocument();
  });

  it("has no accessibility violations (self-service view)", async () => {
    server.use(sessionHandler("tenantAdmin"), ...adminAccountHandlers());
    const { container } = renderPage();
    await screen.findByTestId("preferences-form");
    expect(await axe(container)).toHaveNoViolations();
  });
});
