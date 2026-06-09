import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import type { SessionActor } from "@platform/contracts-auth";

vi.mock("../../hooks/use-session", () => ({
  useSession: vi.fn(),
}));

import { useSession } from "../../hooks/use-session";
import { RequirePermission } from "../../components/RequirePermission";

const actor: SessionActor = {
  userId: "u1",
  tenantId: "t1",
  organisationId: "o1",
  roles: ["viewer"],
  permissions: ["organisation.read"],
  displayName: "Vic Viewer",
};

function mockSession(permissions: string[]) {
  vi.mocked(useSession).mockReturnValue({
    actor: { ...actor, permissions },
    isLoading: false,
    isAuthenticated: true,
    hasPermission: (p: string) => permissions.includes(p),
    error: null,
  });
}

describe("RequirePermission", () => {
  it("renders the forbidden state when the permission is missing", () => {
    mockSession(["organisation.read"]);
    render(
      <RequirePermission permission="organisation.update">
        <div>secret</div>
      </RequirePermission>
    );
    expect(screen.getByText(/access denied/i)).toBeInTheDocument();
    expect(screen.queryByText("secret")).not.toBeInTheDocument();
  });

  it("renders children when the permission is present", () => {
    mockSession(["organisation.read", "organisation.update"]);
    render(
      <RequirePermission permission="organisation.update">
        <div>secret</div>
      </RequirePermission>
    );
    expect(screen.getByText("secret")).toBeInTheDocument();
  });

  it("forbidden state has no accessibility violations", async () => {
    mockSession([]);
    const { container } = render(
      <RequirePermission permission="organisation.read">
        <div>secret</div>
      </RequirePermission>
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
