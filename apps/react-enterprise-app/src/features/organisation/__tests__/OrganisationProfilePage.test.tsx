import { describe, it, expect } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { I18nProvider, enGB } from "@platform/i18n-runtime";
import {
  server,
  sessionHandler,
  createGraphqlHandler,
  graphqlTransportErrorHandler,
  organisationFixture,
} from "../../../msw";
import { OrganisationProfilePage } from "../OrganisationProfilePage";

// Canonical feature test (ADR-ACT-0008, ADR-ACT-0203). MSW-backed end-to-end
// through the real hooks → generated documents → browser client; no hand-rolled
// fetch mocks. Personas drive the permission-gated UI.
function renderPage(): { wrapper: ({ children }: { children: ReactNode }) => ReactNode } {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <I18nProvider locale="en-GB" messages={enGB}>
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </I18nProvider>
    );
  }
  render(<OrganisationProfilePage />, { wrapper: Wrapper });
  return { wrapper: Wrapper };
}

describe("OrganisationProfilePage (canonical feature)", () => {
  it("shows the editable form for a user with organisation.update", async () => {
    server.use(sessionHandler("tenantAdmin"), createGraphqlHandler());
    renderPage();

    const input = await screen.findByTestId("display-name-input");
    expect(input).toHaveValue(organisationFixture.displayName);
    expect(screen.getByTestId("profile-edit-form")).toBeInTheDocument();
    expect(screen.queryByTestId("profile-read-only")).not.toBeInTheDocument();
  });

  it("shows a read-only view for a viewer without organisation.update", async () => {
    server.use(sessionHandler("viewer"), createGraphqlHandler());
    renderPage();

    await screen.findByTestId("profile-read-only");
    expect(screen.getByTestId("display-name-value")).toHaveTextContent(
      organisationFixture.displayName
    );
    expect(screen.queryByTestId("profile-edit-form")).not.toBeInTheDocument();
  });

  it("saves an update and announces success in the live region", async () => {
    server.use(sessionHandler("tenantAdmin"), createGraphqlHandler());
    renderPage();

    await screen.findByTestId("display-name-input");
    await userEvent.click(screen.getByTestId("save-button"));

    await waitFor(() => expect(screen.getByText(/profile saved/i)).toBeInTheDocument());
  });

  it("renders the error state when the profile query fails", async () => {
    server.use(sessionHandler("tenantAdmin"), graphqlTransportErrorHandler(403, "FORBIDDEN"));
    renderPage();

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.queryByTestId("profile-edit-form")).not.toBeInTheDocument();
  });

  it("has no accessibility violations in the editable state", async () => {
    server.use(sessionHandler("tenantAdmin"), createGraphqlHandler());
    const { container } = (() => {
      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      return render(
        <I18nProvider locale="en-GB" messages={enGB}>
          <QueryClientProvider client={queryClient}>
            <OrganisationProfilePage />
          </QueryClientProvider>
        </I18nProvider>
      );
    })();

    await screen.findByTestId("display-name-input");
    expect(await axe(container)).toHaveNoViolations();
  });
});
