import { describe, it, expect } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nProvider, enGB } from "@platform/i18n-runtime";
import type { ReactNode } from "react";
import {
  server,
  adminIdpsHandler,
  adminIdpDiscoverHandler,
  adminIdpCallbackUrlHandler,
  adminIdpTestConnectionHandler,
  adminIdpMappingHandler,
  adminIdpMappingUpdateHandler,
} from "../../../msw";
import { IdpManager } from "../IdpManager";

function renderManager(editable = true) {
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
  return render(<IdpManager editable={editable} />, { wrapper: Wrapper });
}

describe("IdpManager — OIDC enterprise hardening (ADR-0046)", () => {
  it("imports a discovery document and fills the endpoint fields", async () => {
    server.use(adminIdpsHandler(), adminIdpDiscoverHandler());
    renderManager();
    await userEvent.click(await screen.findByTestId("auth-idp-create"));
    await userEvent.type(
      screen.getByTestId("auth-idp-discovery-issuer"),
      "https://idp.example.com"
    );
    await userEvent.click(screen.getByTestId("auth-idp-discovery-import"));
    await waitFor(() =>
      expect(screen.getByTestId("auth-idp-discovery-status")).toHaveTextContent(/OK/i)
    );
    expect(screen.getByTestId("auth-idp-field-authorizationUrl")).toHaveValue(
      "https://idp.example.com/authorize"
    );
    expect(screen.getByTestId("auth-idp-field-tokenUrl")).toHaveValue(
      "https://idp.example.com/token"
    );
  });

  it("shows the brokered callback URL on demand", async () => {
    server.use(adminIdpsHandler(), adminIdpCallbackUrlHandler());
    renderManager();
    await userEvent.click(await screen.findByTestId("auth-idp-callback-mock-google"));
    expect(await screen.findByTestId("auth-idp-callback-url-mock-google")).toHaveTextContent(
      "/broker/mock-google/endpoint"
    );
  });

  it("runs a connection test and announces the classified result", async () => {
    server.use(adminIdpsHandler(), adminIdpTestConnectionHandler());
    renderManager();
    await userEvent.click(await screen.findByTestId("auth-idp-test-mock-google"));
    await waitFor(() =>
      expect(screen.getByTestId("auth-idp-test-result-mock-google")).toHaveTextContent(/OK/i)
    );
  });

  it("opens the mapping editor and validates required fields before save", async () => {
    server.use(adminIdpsHandler(), adminIdpMappingHandler(), adminIdpMappingUpdateHandler());
    renderManager();
    await userEvent.click(await screen.findByTestId("auth-idp-mapping-mock-google"));
    const form = await screen.findByTestId("auth-idp-mapping-form");
    // add an empty claim mapping row then try to save → blocked by validation
    await userEvent.click(screen.getByTestId("auth-idp-claim-add"));
    await userEvent.click(screen.getByTestId("auth-idp-mapping-submit"));
    // the empty row is still present (submit rejected); fill it then save succeeds
    await userEvent.type(
      within(form).getByTestId("auth-idp-field-claimMappings.0.upstreamClaim"),
      "department"
    );
    await userEvent.type(
      within(form).getByTestId("auth-idp-field-claimMappings.0.userAttribute"),
      "department"
    );
    await userEvent.click(screen.getByTestId("auth-idp-mapping-submit"));
    await waitFor(() =>
      expect(screen.queryByTestId("auth-idp-mapping-form")).not.toBeInTheDocument()
    );
  });

  it("never prefills the client secret when editing", async () => {
    server.use(adminIdpsHandler());
    renderManager();
    await userEvent.click(await screen.findByTestId("auth-idp-edit-mock-google"));
    expect(await screen.findByTestId("auth-idp-field-clientSecret")).toHaveValue("");
  });

  it("read-only mode hides create/edit/delete but still allows test + callback", async () => {
    server.use(adminIdpsHandler());
    renderManager(false);
    await screen.findByTestId("auth-idps-list");
    expect(screen.queryByTestId("auth-idp-create")).not.toBeInTheDocument();
    expect(screen.queryByTestId("auth-idp-edit-mock-google")).not.toBeInTheDocument();
    expect(screen.getByTestId("auth-idp-test-mock-google")).toBeInTheDocument();
    expect(screen.getByTestId("auth-idp-callback-mock-google")).toBeInTheDocument();
  });

  it("has no accessibility violations", async () => {
    server.use(adminIdpsHandler());
    const { container } = renderManager();
    await screen.findByTestId("auth-idps-list");
    expect(await axe(container)).toHaveNoViolations();
  });
});
