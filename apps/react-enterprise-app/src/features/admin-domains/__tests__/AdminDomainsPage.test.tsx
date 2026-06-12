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
  adminDomainsListHandler,
  adminDomainsReadinessHandler,
  adminDomainsCreateHandler,
  adminDomainsCreateConflictHandler,
  adminDomainsVerifyHandler,
  adminDomainsRemoveHandler,
  adminDomainsActivateHandler,
  adminDomainsProbeRoutingHandler,
  adminDomainsSetCanonicalHandler,
  adminDomainsUnsetCanonicalHandler,
} from "../../../msw";
import { AdminDomainsPage } from "../AdminDomainsPage";

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
  return render(<AdminDomainsPage />, { wrapper: Wrapper });
}

describe("AdminDomainsPage (ADR-0048)", () => {
  it("renders the domain list and readiness banner", async () => {
    server.use(
      sessionHandler("tenantAdmin"),
      adminDomainsListHandler(),
      adminDomainsReadinessHandler()
    );
    renderPage();
    expect(await screen.findByTestId("admin-domains-table")).toBeInTheDocument();
    // The readiness banner renders the localised message for the fixture status (pending_verification).
    expect(await screen.findByTestId("admin-domains-readiness-text")).not.toBeEmptyDOMElement();
    expect(screen.getByTestId("admin-domains-readiness-badge")).toHaveTextContent(
      "pending_verification"
    );
    expect(screen.getByTestId("admin-domains-domain-app.example.com")).toBeInTheDocument();
  });

  it("adds a domain and shows the TXT record then announces success", async () => {
    server.use(
      sessionHandler("tenantAdmin"),
      adminDomainsListHandler({ domains: [] }),
      adminDomainsReadinessHandler(),
      adminDomainsCreateHandler()
    );
    renderPage();
    await screen.findByTestId("admin-domains-add-form");
    const input = screen.getByTestId("admin-domains-domain-input");
    await userEvent.type(input, "custom.example.com");
    await userEvent.click(screen.getByTestId("admin-domains-add-button"));
    await waitFor(() =>
      expect(screen.getByTestId("admin-domains-added")).toHaveTextContent(/added/i)
    );
    expect(await screen.findByTestId("admin-domains-txt-panel")).toBeInTheDocument();
    expect(screen.getByTestId("admin-domains-txt-name")).toHaveTextContent(
      "_platform-verify.custom.example.com"
    );
    expect(screen.getByTestId("admin-domains-txt-value")).toHaveTextContent("verify-token-abc123");
  });

  it("shows the explicit conflict message when the domain is claimed by another tenant (409)", async () => {
    server.use(
      sessionHandler("tenantAdmin"),
      adminDomainsListHandler({ domains: [] }),
      adminDomainsReadinessHandler(),
      adminDomainsCreateConflictHandler()
    );
    renderPage();
    await screen.findByTestId("admin-domains-add-form");
    await userEvent.type(screen.getByTestId("admin-domains-domain-input"), "claimed.example.com");
    await userEvent.click(screen.getByTestId("admin-domains-add-button"));
    const error = await screen.findByTestId("admin-domains-add-error");
    expect(error).toHaveTextContent(/already claimed by another organisation/i);
    // No TXT panel — the conflict response carries no token.
    expect(screen.queryByTestId("admin-domains-txt-panel")).not.toBeInTheDocument();
  });

  it("verifies a domain and announces success", async () => {
    server.use(
      sessionHandler("tenantAdmin"),
      adminDomainsListHandler(),
      adminDomainsReadinessHandler(),
      adminDomainsVerifyHandler()
    );
    renderPage();
    const verifyBtn = await screen.findByTestId("admin-domains-verify-app.example.com");
    await userEvent.click(verifyBtn);
    await waitFor(() =>
      expect(
        screen.getByTestId("admin-domains-verify-announce-app.example.com")
      ).not.toBeEmptyDOMElement()
    );
  });

  it("removes a domain and announces success", async () => {
    server.use(
      sessionHandler("tenantAdmin"),
      adminDomainsListHandler(),
      adminDomainsReadinessHandler(),
      adminDomainsRemoveHandler()
    );
    renderPage();
    const removeBtn = await screen.findByTestId("admin-domains-remove-app.example.com");
    await userEvent.click(removeBtn);
    await waitFor(() =>
      expect(screen.getByTestId("admin-domains-remove-announce-app.example.com")).toHaveTextContent(
        /removed/i
      )
    );
  });

  it("is read-only without write permission (viewer has no tenant.domains.write)", async () => {
    server.use(sessionHandler("viewer"), adminDomainsListHandler(), adminDomainsReadinessHandler());
    renderPage();
    await screen.findByTestId("admin-domains");
    // No add form rendered when canWrite is false
    expect(screen.queryByTestId("admin-domains-add-form")).not.toBeInTheDocument();
    // No verify or remove buttons
    expect(screen.queryByTestId("admin-domains-verify-app.example.com")).not.toBeInTheDocument();
    expect(screen.queryByTestId("admin-domains-remove-app.example.com")).not.toBeInTheDocument();
  });

  it("has no accessibility violations", async () => {
    server.use(
      sessionHandler("tenantAdmin"),
      adminDomainsListHandler(),
      adminDomainsReadinessHandler()
    );
    const { container } = renderPage();
    await screen.findByTestId("admin-domains-table");
    expect(await axe(container)).toHaveNoViolations();
  });
});

// --- ADR-ACT-0232 lifecycle fixtures -----------------------------------------

function domainFixture(over: Record<string, unknown> = {}) {
  return {
    domain: "app.example.com",
    source: "custom",
    status: "pending_dns",
    authClient: "inactive",
    tls: "tls_unknown",
    routing: "routing_unknown",
    canonical: false,
    redirectPolicy: "no_redirect",
    redirectActive: false,
    txtRecord: "_platform-verify.app.example.com",
    createdAt: "2026-06-12T00:00:00Z",
    verifiedAt: null,
    expiresAt: null,
    authClientActivatedAt: null,
    routingLocalProvenAt: null,
    routingPublicProvenAt: null,
    tlsLocalProvenAt: null,
    tlsPublicProvenAt: null,
    canonicalAt: null,
    ...over,
  };
}

describe("AdminDomainsPage lifecycle actions (ADR-ACT-0232)", () => {
  it("offers Activate only for a verified, inactive domain and announces activation", async () => {
    server.use(
      sessionHandler("tenantAdmin"),
      adminDomainsListHandler({
        domains: [domainFixture({ status: "verified", verifiedAt: "2026-06-12T00:00:00Z" })],
      }),
      adminDomainsReadinessHandler(),
      adminDomainsActivateHandler()
    );
    renderPage();
    const activateBtn = await screen.findByTestId("admin-domains-activate-app.example.com");
    // verify is hidden for an already-verified domain
    expect(screen.queryByTestId("admin-domains-verify-app.example.com")).toBeNull();
    // probe/canonical/deactivate hidden while inactive
    expect(screen.queryByTestId("admin-domains-probe-app.example.com")).toBeNull();
    expect(screen.queryByTestId("admin-domains-set-canonical-app.example.com")).toBeNull();
    expect(screen.queryByTestId("admin-domains-deactivate-app.example.com")).toBeNull();
    await userEvent.click(activateBtn);
    await waitFor(() =>
      expect(
        screen.getByTestId("admin-domains-lifecycle-announce-app.example.com")
      ).not.toBeEmptyDOMElement()
    );
  });

  it("offers the local routing probe + deactivate for an active domain; canonical stays hidden until routing is proven", async () => {
    server.use(
      sessionHandler("tenantAdmin"),
      adminDomainsListHandler({
        domains: [
          domainFixture({
            status: "verified",
            authClient: "active",
            authClientActivatedAt: "2026-06-12T00:00:00Z",
          }),
        ],
      }),
      adminDomainsReadinessHandler(),
      adminDomainsProbeRoutingHandler()
    );
    renderPage();
    expect(await screen.findByTestId("admin-domains-probe-app.example.com")).toBeInTheDocument();
    expect(screen.getByTestId("admin-domains-deactivate-app.example.com")).toBeInTheDocument();
    // routing not proven -> set-canonical hidden (mirrors the server guard)
    expect(screen.queryByTestId("admin-domains-set-canonical-app.example.com")).toBeNull();
    await userEvent.click(screen.getByTestId("admin-domains-probe-app.example.com"));
    await waitFor(() =>
      expect(
        screen.getByTestId("admin-domains-lifecycle-announce-app.example.com")
      ).not.toBeEmptyDOMElement()
    );
  });

  it("offers Set canonical once routing is locally proven, and unset for a canonical domain", async () => {
    server.use(
      sessionHandler("tenantAdmin"),
      adminDomainsListHandler({
        domains: [
          domainFixture({
            domain: "app.example.com",
            status: "verified",
            authClient: "active",
            routing: "routing_local_active",
            routingLocalProvenAt: "2026-06-12T00:00:00Z",
          }),
          domainFixture({
            domain: "canon.example.com",
            status: "verified",
            authClient: "active",
            routing: "routing_local_active",
            canonical: true,
            canonicalAt: "2026-06-12T00:00:00Z",
            txtRecord: "_platform-verify.canon.example.com",
          }),
        ],
      }),
      adminDomainsReadinessHandler(),
      adminDomainsSetCanonicalHandler(),
      adminDomainsUnsetCanonicalHandler()
    );
    renderPage();
    expect(
      await screen.findByTestId("admin-domains-set-canonical-app.example.com")
    ).toBeInTheDocument();
    expect(screen.getByTestId("admin-domains-canonical-canon.example.com")).toHaveTextContent(
      /canonical marker/i
    );
    // Canonical is a MARKER — the no-redirect truth is shown with the badge
    // (visible to every viewer, ADR-ACT-0236).
    expect(screen.getByTestId("admin-domains-canonical-note-canon.example.com")).toHaveTextContent(
      /no redirect is active — public cutover not proven/i
    );
    expect(
      screen.getByTestId("admin-domains-unset-canonical-canon.example.com")
    ).toBeInTheDocument();
    // an already-canonical domain is not offered set-canonical again
    expect(screen.queryByTestId("admin-domains-set-canonical-canon.example.com")).toBeNull();
  });

  it("shows the no-redirect canonical note to read-only viewers too", async () => {
    server.use(
      sessionHandler("viewer"),
      adminDomainsListHandler({
        domains: [
          domainFixture({
            status: "verified",
            authClient: "active",
            routing: "routing_local_active",
            canonical: true,
            canonicalAt: "2026-06-12T00:00:00Z",
          }),
        ],
      }),
      adminDomainsReadinessHandler()
    );
    renderPage();
    await screen.findByTestId("admin-domains-table");
    expect(screen.getByTestId("admin-domains-canonical-note-app.example.com")).toHaveTextContent(
      /no redirect is active/i
    );
  });

  it("hides every lifecycle action without tenant.domains.write", async () => {
    server.use(
      sessionHandler("viewer"),
      adminDomainsListHandler({
        domains: [
          domainFixture({
            status: "verified",
            authClient: "active",
            routing: "routing_local_active",
          }),
        ],
      }),
      adminDomainsReadinessHandler()
    );
    renderPage();
    await screen.findByTestId("admin-domains-table");
    for (const action of ["activate", "probe", "set-canonical", "deactivate", "remove"]) {
      expect(screen.queryByTestId(`admin-domains-${action}-app.example.com`)).toBeNull();
    }
  });
});
