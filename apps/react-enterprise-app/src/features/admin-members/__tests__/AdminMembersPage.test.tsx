import { describe, it, expect } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nProvider, enGB } from "@platform/i18n-runtime";
import type { ReactNode } from "react";
import { http, HttpResponse } from "msw";
import { server, sessionHandler, adminMembersHandler, adminGetErrorHandler } from "../../../msw";
import { AdminMembersPage } from "../AdminMembersPage";

const MEMBER_ID = "00000000-0000-0000-0000-0000000000b2"; // member@example.com, status disabled
const ADMIN_ID = "00000000-0000-0000-0000-0000000000a1"; // admin@example.com, username "admin"

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
  return render(<AdminMembersPage />, { wrapper: Wrapper });
}

describe("AdminMembersPage", () => {
  it("lists members and pending invitations for a tenant admin", async () => {
    server.use(sessionHandler("tenantAdmin"), adminMembersHandler());
    renderPage();
    await screen.findByText("admin@example.com");
    expect(screen.getByText("member@example.com")).toBeInTheDocument();
    expect(screen.getByTestId("member-invite-open")).toBeInTheDocument();
    expect(screen.getByTestId("member-pending")).toHaveTextContent("invited@example.com");
  });

  it("invites a member and closes the dialog on success", async () => {
    server.use(sessionHandler("tenantAdmin"), adminMembersHandler());
    renderPage();
    await userEvent.click(await screen.findByTestId("member-invite-open"));
    const form = await screen.findByTestId("member-invite-form");
    await userEvent.type(within(form).getByTestId("member-invite-email"), "new@example.com");
    await userEvent.click(within(form).getByTestId("member-invite-submit"));
    await waitFor(() => expect(screen.queryByTestId("member-invite-form")).not.toBeInTheDocument());
  });

  it("removes a member after confirmation", async () => {
    server.use(sessionHandler("tenantAdmin"), adminMembersHandler());
    renderPage();
    const firstRemove = await screen.findByTestId(
      "member-remove-00000000-0000-0000-0000-0000000000b2"
    );
    await userEvent.click(firstRemove);
    await userEvent.click(await screen.findByTestId("member-remove-confirm"));
    await waitFor(() =>
      expect(screen.getByTestId("members-status")).toHaveTextContent(/changes saved/i)
    );
  });

  it("is read-only for a viewer (no invite, role shown as a badge, no remove)", async () => {
    server.use(sessionHandler("viewer"), adminMembersHandler());
    renderPage();
    await screen.findByText("admin@example.com");
    expect(screen.queryByTestId("member-invite-open")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("member-role-00000000-0000-0000-0000-0000000000b2")
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("member-remove-00000000-0000-0000-0000-0000000000b2")
    ).not.toBeInTheDocument();
  });

  it("renders a retryable error state when members fail to load", async () => {
    server.use(sessionHandler("tenantAdmin"), adminGetErrorHandler("/api/org/members", 500));
    renderPage();
    await screen.findByTestId("admin-error-error");
  });

  it("renders the forbidden state on a 403", async () => {
    server.use(sessionHandler("tenantAdmin"), adminGetErrorHandler("/api/org/members", 403));
    renderPage();
    await screen.findByTestId("admin-error-forbidden");
  });

  it("renders the session-expired state on a 401", async () => {
    server.use(sessionHandler("tenantAdmin"), adminGetErrorHandler("/api/org/members", 401));
    renderPage();
    await screen.findByTestId("admin-error-unauthorized");
    expect(screen.getByTestId("admin-error-signin")).toHaveAttribute("href", "/login");
  });

  it("has no accessibility violations", async () => {
    server.use(sessionHandler("tenantAdmin"), adminMembersHandler());
    const { container } = renderPage();
    await screen.findByText("admin@example.com");
    expect(await axe(container)).toHaveNoViolations();
  });

  // --- membership v2 (ADR-ACT-0206) ---

  it("renders username, status, and last-login columns", async () => {
    server.use(sessionHandler("tenantAdmin"), adminMembersHandler());
    renderPage();
    await screen.findByText("admin@example.com");
    expect(screen.getByTestId(`member-username-${ADMIN_ID}`)).toHaveTextContent("admin");
    expect(screen.getByTestId(`member-status-${ADMIN_ID}`)).toHaveTextContent(/active/i);
    expect(screen.getByTestId(`member-status-${MEMBER_ID}`)).toHaveTextContent(/disabled/i);
  });

  it("edits a member's username and lists external identities in the detail row", async () => {
    server.use(sessionHandler("tenantAdmin"), adminMembersHandler());
    renderPage();
    await screen.findByText("admin@example.com");
    await userEvent.click(screen.getByTestId(`member-expand-${ADMIN_ID}`));
    const detail = await screen.findByTestId(`member-detail-${ADMIN_ID}`);
    // external identities loaded
    await within(detail).findByTestId(`member-external-${ADMIN_ID}`);
    expect(within(detail).getByText("mock-google")).toBeInTheDocument();
    // edit username
    const input = within(detail).getByTestId(`member-username-input-${ADMIN_ID}`);
    await userEvent.clear(input);
    await userEvent.type(input, "jane.doe");
    await userEvent.click(within(detail).getByTestId(`member-username-save-${ADMIN_ID}`));
    await waitFor(() => expect(screen.getByText(/username saved/i)).toBeInTheDocument());
  });

  it("shows a conflict error when the username is taken", async () => {
    server.use(
      sessionHandler("tenantAdmin"),
      adminMembersHandler(),
      http.patch("/api/org/members/:userId/username", () =>
        HttpResponse.json({ code: "CONFLICT", message: "taken" }, { status: 409 })
      )
    );
    renderPage();
    await screen.findByText("admin@example.com");
    await userEvent.click(screen.getByTestId(`member-expand-${ADMIN_ID}`));
    const input = await screen.findByTestId(`member-username-input-${ADMIN_ID}`);
    await userEvent.clear(input);
    await userEvent.type(input, "taken.name");
    await userEvent.click(screen.getByTestId(`member-username-save-${ADMIN_ID}`));
    await waitFor(() =>
      expect(screen.getByTestId(`member-username-error-${ADMIN_ID}`)).toHaveTextContent(
        /already taken/i
      )
    );
  });

  it("enables a disabled member", async () => {
    server.use(sessionHandler("tenantAdmin"), adminMembersHandler());
    renderPage();
    await screen.findByText("member@example.com");
    await userEvent.click(screen.getByTestId(`member-expand-${MEMBER_ID}`));
    const toggle = await screen.findByTestId(`member-status-toggle-${MEMBER_ID}`);
    expect(toggle).toHaveTextContent(/enable member/i); // disabled member ⇒ "Enable"
    await userEvent.click(toggle);
    await waitFor(() => expect(toggle).not.toBeDisabled());
  });

  it("resends a pending invitation", async () => {
    server.use(sessionHandler("tenantAdmin"), adminMembersHandler());
    renderPage();
    await screen.findByTestId("member-pending");
    await userEvent.click(screen.getByTestId("member-resend-invited@example.com"));
    await waitFor(() =>
      expect(screen.getByTestId("member-resend-status")).toHaveTextContent(/invitation resent/i)
    );
  });

  it("hides write controls for a viewer (no username edit / status toggle / resend)", async () => {
    server.use(sessionHandler("viewer"), adminMembersHandler());
    renderPage();
    await screen.findByText("admin@example.com");
    await userEvent.click(screen.getByTestId(`member-expand-${ADMIN_ID}`));
    await screen.findByTestId(`member-detail-${ADMIN_ID}`);
    expect(screen.queryByTestId(`member-username-save-${ADMIN_ID}`)).not.toBeInTheDocument();
    expect(screen.queryByTestId(`member-status-toggle-${ADMIN_ID}`)).not.toBeInTheDocument();
    expect(screen.queryByTestId("member-resend-invited@example.com")).not.toBeInTheDocument();
  });
});
