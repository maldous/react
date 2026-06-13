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
  adminDeveloperHandlers,
  adminGetErrorHandler,
} from "../../../msw";
import { AdminDeveloperPage } from "../AdminDeveloperPage";

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
  return render(<AdminDeveloperPage />, { wrapper: Wrapper });
}

async function selectFixtureTenant() {
  const region = await screen.findByTestId("developer-tenant-form");
  await userEvent.click(within(region).getByRole("button"));
  await userEvent.click(await screen.findByRole("option", { name: /fixture-org/i }));
}

describe("AdminDeveloperPage", () => {
  it("shows the tenant self-service developer view with the API surface + keys", async () => {
    server.use(sessionHandler("tenantAdmin"), ...adminDeveloperHandlers());
    renderPage();
    expect(await screen.findByTestId("developer-foundation")).toBeInTheDocument();
    expect(await screen.findByTestId("api-key-create-form")).toBeInTheDocument();
    expect((await screen.findAllByTestId("api-key-row")).length).toBeGreaterThan(0);
    // No operator tenant picker in self-service mode.
    expect(screen.queryByTestId("developer-tenant-form")).not.toBeInTheDocument();
  });

  it("reveals the plaintext secret exactly once after creating a key", async () => {
    server.use(sessionHandler("tenantAdmin"), ...adminDeveloperHandlers());
    renderPage();
    const name = await screen.findByTestId("api-key-name");
    await userEvent.type(name, "deploy");
    await userEvent.click(screen.getByTestId("api-key-create-submit"));
    const secret = await screen.findByTestId("api-key-secret-value");
    expect(secret.textContent ?? "").toMatch(/^sk_/);
    // Dismiss hides the one-time secret.
    await userEvent.click(screen.getByTestId("api-key-secret-dismiss"));
    await waitFor(() => expect(screen.queryByTestId("api-key-secret")).not.toBeInTheDocument());
  });

  it("lets a system operator pick a tenant and set a rate limit", async () => {
    server.use(
      sessionHandler("systemAdmin"),
      adminTenantsLookupHandler(),
      ...adminDeveloperHandlers()
    );
    renderPage();
    await selectFixtureTenant();
    expect(await screen.findByTestId("rate-limit-set-form")).toBeInTheDocument();
    expect((await screen.findAllByTestId("rate-limit-row")).length).toBeGreaterThan(0);
    await userEvent.click(screen.getByTestId("rate-limit-submit"));
    await waitFor(() => expect(screen.queryByTestId("rate-limit-error")).not.toBeInTheDocument());
    // Operator console — not the tenant self-service create form.
    expect(screen.queryByTestId("api-key-create-form")).not.toBeInTheDocument();
  });

  it("renders an error state when the tenant key list fails", async () => {
    server.use(
      sessionHandler("tenantAdmin"),
      adminGetErrorHandler("/api/org/api-keys", 500),
      adminGetErrorHandler("/api/org/developer", 500)
    );
    renderPage();
    await screen.findAllByTestId("admin-error-error");
  });

  it("has no accessibility violations (self-service view)", async () => {
    server.use(sessionHandler("tenantAdmin"), ...adminDeveloperHandlers());
    const { container } = renderPage();
    await screen.findAllByTestId("api-key-row");
    expect(await axe(container)).toHaveNoViolations();
  });
});
