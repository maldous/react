import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import type { SessionActor } from "@platform/contracts-auth";

// Mock useSession and the router primitives the layout + AppShell use.
vi.mock("../../hooks/use-session", () => ({
  useSession: vi.fn(),
}));
vi.mock("@tanstack/react-router", () => ({
  Outlet: () => <div data-testid="outlet">routed page</div>,
  Navigate: ({ to }: { to: string }) => <div data-testid="navigate" data-to={to} />,
  Link: ({ to, children, ...props }: { to: string; children: React.ReactNode }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}));

import { useSession } from "../../hooks/use-session";
import { AuthenticatedLayout } from "../../components/AuthenticatedLayout";

const actor: SessionActor = {
  userId: "u1",
  tenantId: "t1",
  organisationId: "o1",
  roles: ["tenant-admin"],
  permissions: ["organisation.read"],
  displayName: "Ada Admin",
};

function mockSession(overrides: Partial<ReturnType<typeof useSession>>) {
  vi.mocked(useSession).mockReturnValue({
    actor: null,
    isLoading: false,
    isAuthenticated: false,
    hasPermission: () => false,
    error: null,
    ...overrides,
  });
}

describe("AuthenticatedLayout", () => {
  it("shows the loading state while the session is loading", () => {
    mockSession({ isLoading: true });
    render(<AuthenticatedLayout />);
    expect(screen.getByText(/checking authentication/i)).toBeInTheDocument();
  });

  it("shows a session-error alert on a non-401 session failure", () => {
    mockSession({
      error: Object.assign(new Error("Session unavailable (503)"), { status: 503, code: "x" }),
    });
    render(<AuthenticatedLayout />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    // Shell chrome is not rendered in the error state.
    expect(screen.queryByTestId("app-shell-main")).not.toBeInTheDocument();
  });

  it("redirects to /login when unauthenticated", () => {
    mockSession({ isAuthenticated: false });
    render(<AuthenticatedLayout />);
    expect(screen.getByTestId("navigate")).toHaveAttribute("data-to", "/login");
  });

  it("renders the AppShell with a single main landmark and the routed Outlet when authenticated", () => {
    mockSession({ actor, isAuthenticated: true });
    const { container } = render(<AuthenticatedLayout />);

    const mains = container.querySelectorAll("main#main-content");
    expect(mains).toHaveLength(1);
    expect(screen.getByTestId("outlet")).toBeInTheDocument();
    expect(screen.getByText("Ada Admin")).toBeInTheDocument();
  });

  it("authenticated layout has no accessibility violations", async () => {
    mockSession({ actor, isAuthenticated: true });
    const { container } = render(<AuthenticatedLayout />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
