import { describe, it, expect } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nProvider, enGB } from "@platform/i18n-runtime";
import type { ReactNode } from "react";
import { server, sessionHandler, adminMembersHandler, adminGetErrorHandler } from "../../../msw";
import { AdminMembersPage } from "../AdminMembersPage";

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

  it("renders the error state when members fail to load", async () => {
    server.use(sessionHandler("tenantAdmin"), adminGetErrorHandler("/api/org/members", 503));
    renderPage();
    await screen.findByText(enGB.feature.admin.members.error);
  });

  it("has no accessibility violations", async () => {
    server.use(sessionHandler("tenantAdmin"), adminMembersHandler());
    const { container } = renderPage();
    await screen.findByText("admin@example.com");
    expect(await axe(container)).toHaveNoViolations();
  });
});
