import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";

// Mock useSession and Navigate before importing ProtectedRoute
vi.mock("../../hooks/use-session", () => ({
  useSession: vi.fn(),
}));
vi.mock("@tanstack/react-router", () => ({
  Navigate: ({ to }: { to: string }) => <div data-testid="navigate" data-to={to} />,
}));

import { useSession } from "../../hooks/use-session";
import { ProtectedRoute } from "../../components/ProtectedRoute";

describe("ProtectedRoute", () => {
  it("shows loading state while session is loading", () => {
    vi.mocked(useSession).mockReturnValue({
      actor: null,
      isLoading: true,
      isAuthenticated: false,
      hasPermission: () => false,
      error: null,
    });
    render(<ProtectedRoute>Protected Content</ProtectedRoute>);
    expect(screen.getByText(/checking authentication/i)).toBeInTheDocument();
  });

  it("redirects to /auth/login when unauthenticated", () => {
    vi.mocked(useSession).mockReturnValue({
      actor: null,
      isLoading: false,
      isAuthenticated: false,
      hasPermission: () => false,
      error: null,
    });
    render(<ProtectedRoute>Protected Content</ProtectedRoute>);
    const nav = screen.getByTestId("navigate");
    expect(nav).toHaveAttribute("data-to", "/auth/login");
  });

  it("shows forbidden state when authenticated but missing permission", () => {
    vi.mocked(useSession).mockReturnValue({
      actor: {
        userId: "u1",
        tenantId: "t1",
        organisationId: "t1",
        roles: ["viewer"],
        permissions: ["organisation.read"],
        displayName: "Viewer",
      },
      isLoading: false,
      isAuthenticated: true,
      hasPermission: (p: string) => p === "organisation.read",
      error: null,
    });
    render(<ProtectedRoute permission="organisation.update">Protected Content</ProtectedRoute>);
    expect(screen.getByText(/access denied/i)).toBeInTheDocument();
  });

  it("renders children when authenticated and has permission", () => {
    vi.mocked(useSession).mockReturnValue({
      actor: {
        userId: "u1",
        tenantId: "t1",
        organisationId: "t1",
        roles: ["tenant-admin"],
        permissions: ["organisation.read", "organisation.update"],
        displayName: "Admin",
      },
      isLoading: false,
      isAuthenticated: true,
      hasPermission: () => true,
      error: null,
    });
    render(<ProtectedRoute permission="organisation.update">Protected Content</ProtectedRoute>);
    expect(screen.getByText("Protected Content")).toBeInTheDocument();
  });

  it("renders children when no permission required and authenticated", () => {
    vi.mocked(useSession).mockReturnValue({
      actor: {
        userId: "u1",
        tenantId: "t1",
        organisationId: "t1",
        roles: ["viewer"],
        permissions: ["organisation.read"],
        displayName: "Viewer",
      },
      isLoading: false,
      isAuthenticated: true,
      hasPermission: () => true,
      error: null,
    });
    render(<ProtectedRoute>Public Protected Content</ProtectedRoute>);
    expect(screen.getByText("Public Protected Content")).toBeInTheDocument();
  });

  it("protected route has no accessibility violations when rendered", async () => {
    vi.mocked(useSession).mockReturnValue({
      actor: {
        userId: "u1",
        tenantId: "t1",
        organisationId: "t1",
        roles: ["viewer"],
        permissions: ["organisation.read"],
        displayName: "Viewer",
      },
      isLoading: false,
      isAuthenticated: true,
      hasPermission: () => true,
      error: null,
    });
    const { container } = render(<ProtectedRoute>Content</ProtectedRoute>);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
