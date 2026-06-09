import { describe, it, expect } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { axe } from "vitest-axe";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nProvider, enGB } from "@platform/i18n-runtime";
import type { ReactNode } from "react";
import {
  server,
  providersHandler,
  providersEmptyHandler,
  providersErrorHandler,
  providersFixture,
  platformOnlyProvidersFixture,
} from "../../msw";
import { LoginPage } from "../login";

// Login selector tests (ADR-ACT-0157). MSW-backed through the real
// useLoginProviders hook; asserts the selector renders configured providers,
// links only to the BFF handoff, and handles loading/empty/error states.
function renderLogin() {
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
  return render(<LoginPage />, { wrapper: Wrapper });
}

describe("LoginPage (provider selector)", () => {
  it("renders a button per configured provider", async () => {
    server.use(providersHandler());
    renderLogin();

    await screen.findByTestId("login-providers");
    for (const p of providersFixture) {
      const testId = p.id === "platform" ? "sign-in-button" : `login-provider-${p.id}`;
      expect(screen.getByTestId(testId)).toBeInTheDocument();
    }
  });

  it("links each provider to its BFF loginUrl and never to Keycloak/mock-oidc", async () => {
    server.use(providersHandler());
    renderLogin();

    await screen.findByTestId("login-providers");
    const links = screen.getAllByRole("link");
    expect(links.length).toBe(providersFixture.length);
    for (const link of links) {
      const href = link.getAttribute("href") ?? "";
      // Every button targets the BFF handoff only.
      expect(href).toMatch(/^\/auth\/login\?provider=/);
      // No direct links to Keycloak or the mock-oidc fixture leak into the DOM.
      expect(href).not.toMatch(/kc_idp_hint|\/realms\/|mock-oidc|localhost:9080|localhost:8090/);
    }
  });

  it("shows a 'Mock provider' badge for mock-mode providers but not the platform option", async () => {
    server.use(providersHandler());
    renderLogin();

    await screen.findByTestId("login-providers");
    // providersFixture: google/azure/apple are mode:"mock"; platform is mode:"internal".
    expect(screen.getByTestId("login-provider-mock-google")).toBeInTheDocument();
    expect(screen.getByTestId("login-provider-mock-azure")).toBeInTheDocument();
    expect(screen.getByTestId("login-provider-mock-apple")).toBeInTheDocument();
    expect(screen.queryByTestId("login-provider-mock-platform")).not.toBeInTheDocument();
    // The badge text is present for mock providers.
    expect(screen.getAllByText("Mock provider").length).toBeGreaterThanOrEqual(3);
  });

  it("renders provider helper text from i18n", async () => {
    server.use(providersHandler());
    renderLogin();
    await screen.findByTestId("login-providers");
    expect(screen.getByText("Continue with your Google account.")).toBeInTheDocument();
    expect(screen.getByText("Use your platform account.")).toBeInTheDocument();
  });

  it("routes the platform button to the platform handoff", async () => {
    server.use(providersHandler());
    renderLogin();

    const platform = await screen.findByTestId("sign-in-button");
    expect(platform).toHaveAttribute("href", "/auth/login?provider=platform");
  });

  it("shows only the platform login when that is all that is enabled", async () => {
    server.use(providersHandler(platformOnlyProvidersFixture));
    renderLogin();

    await screen.findByTestId("sign-in-button");
    expect(screen.queryByTestId("login-provider-google")).not.toBeInTheDocument();
  });

  it("shows the loading state before the list resolves", () => {
    server.use(providersHandler());
    renderLogin();
    expect(screen.getByTestId("login-loading")).toBeInTheDocument();
  });

  it("shows the empty state when no providers are returned", async () => {
    server.use(providersEmptyHandler());
    renderLogin();
    await screen.findByTestId("login-empty");
  });

  it("shows the error state when the provider list fails", async () => {
    server.use(providersErrorHandler());
    renderLogin();
    await screen.findByTestId("login-error");
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("has no accessibility violations", async () => {
    server.use(providersHandler());
    const { container } = renderLogin();
    await screen.findByTestId("login-providers");
    await waitFor(async () => expect(await axe(container)).toHaveNoViolations());
  });
});
