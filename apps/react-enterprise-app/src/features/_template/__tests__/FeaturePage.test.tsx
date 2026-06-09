import { describe, it, expect } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { server, sessionHandler, createGraphqlHandler, graphqlErrorResolver } from "../../../msw";
import { FeaturePage } from "../FeaturePage";

// Canonical feature test shape (ADR-ACT-0203): MSW-backed, persona-driven, no
// hand-rolled fetch mocks. Extend src/msw/graphql/factories.ts with resolvers
// for your operations (WidgetList, CreateWidget) keyed by operation name.

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }
  return render(<FeaturePage />, { wrapper: Wrapper });
}

describe("FeaturePage", () => {
  it("renders the create form for a user with widget.create", async () => {
    server.use(
      sessionHandler("tenantAdmin"),
      createGraphqlHandler({ WidgetList: () => ({ data: { widgets: [] } }) })
    );
    renderPage();
    expect(await screen.findByTestId("widget-name-input")).toBeInTheDocument();
  });

  it("shows the empty state when there are no widgets", async () => {
    server.use(sessionHandler("viewer"), createGraphqlHandler({ WidgetList: () => ({ data: { widgets: [] } }) }));
    renderPage();
    await waitFor(() => expect(screen.getByText(/no .*widget/i)).toBeInTheDocument());
  });

  it("renders the error state when the list query fails", async () => {
    server.use(
      sessionHandler("tenantAdmin"),
      createGraphqlHandler({ WidgetList: graphqlErrorResolver("boom") })
    );
    renderPage();
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
  });

  it("creates a widget and resets the form", async () => {
    server.use(
      sessionHandler("tenantAdmin"),
      createGraphqlHandler({
        WidgetList: () => ({ data: { widgets: [] } }),
        CreateWidget: ({ variables }) => ({ data: { createWidget: { id: "1", name: variables.name } } }),
      })
    );
    renderPage();
    await userEvent.type(await screen.findByTestId("widget-name-input"), "Gadget");
    await userEvent.click(screen.getByTestId("widget-save"));
    await waitFor(() => expect(screen.getByTestId("widget-name-input")).toHaveValue(""));
  });
});
