import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";

// Mock all hooks and router before importing components that use them
vi.mock("../../hooks/use-session", () => ({
  useSession: vi.fn(),
}));

vi.mock("../../features/organisation/use-organisation-profile", () => ({
  useOrganisationProfile: vi.fn(),
  organisationProfileQueryKey: ["organisation", "profile"],
}));

vi.mock("../../features/organisation/use-update-organisation-profile", () => ({
  useUpdateOrganisationProfile: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  Navigate: ({ to }: { to: string }) => <div data-testid="navigate" data-to={to} />,
}));

import { useSession } from "../../hooks/use-session";
import { useOrganisationProfile } from "../../features/organisation/use-organisation-profile";
import { useUpdateOrganisationProfile } from "../../features/organisation/use-update-organisation-profile";
import { OrganisationProfilePage } from "../../features/organisation/OrganisationProfilePage";

const mockProfile = {
  id: "00000000-0000-0000-0000-000000000001",
  slug: "fixture-org",
  displayName: "Fixture Organisation",
  createdAt: "2024-01-01T00:00:00.000Z",
  updatedAt: "2024-01-01T00:00:00.000Z",
};

const adminSession = {
  actor: {
    userId: "00000000-0000-0000-0000-000000000002",
    tenantId: "00000000-0000-0000-0000-000000000001",
    organisationId: "00000000-0000-0000-0000-000000000001",
    roles: ["tenant-admin"],
    permissions: ["organisation.read", "organisation.update"],
    displayName: "Fixture Admin",
  },
  isLoading: false,
  isAuthenticated: true,
  hasPermission: (p: string) => ["organisation.read", "organisation.update"].includes(p),
  error: null,
};

const viewerSession = {
  actor: {
    userId: "00000000-0000-0000-0000-000000000003",
    tenantId: "00000000-0000-0000-0000-000000000001",
    organisationId: "00000000-0000-0000-0000-000000000001",
    roles: ["viewer"],
    permissions: ["organisation.read", "member.read"],
    displayName: "Fixture Viewer",
  },
  isLoading: false,
  isAuthenticated: true,
  hasPermission: (p: string) => ["organisation.read", "member.read"].includes(p),
  error: null,
};

const noSession = {
  actor: null,
  isLoading: false,
  isAuthenticated: false,
  hasPermission: () => false,
  error: null,
};

const idleMutation = {
  mutate: vi.fn(),
  isPending: false,
  isSuccess: false,
  isError: false,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("OrganisationProfilePage", () => {
  it("renders loading state while profile is loading", () => {
    vi.mocked(useSession).mockReturnValue(adminSession);
    vi.mocked(useOrganisationProfile).mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
    } as ReturnType<typeof useOrganisationProfile>);
    vi.mocked(useUpdateOrganisationProfile).mockReturnValue(
      idleMutation as unknown as ReturnType<typeof useUpdateOrganisationProfile>
    );

    render(<OrganisationProfilePage />);
    expect(screen.getByText(/loading organisation profile/i)).toBeInTheDocument();
  });

  it("tenant-admin sees editable form with display name input", async () => {
    vi.mocked(useSession).mockReturnValue(adminSession);
    vi.mocked(useOrganisationProfile).mockReturnValue({
      data: mockProfile,
      isLoading: false,
      isError: false,
    } as ReturnType<typeof useOrganisationProfile>);
    vi.mocked(useUpdateOrganisationProfile).mockReturnValue(
      idleMutation as unknown as ReturnType<typeof useUpdateOrganisationProfile>
    );

    render(<OrganisationProfilePage />);

    await waitFor(() => {
      expect(screen.getByTestId("profile-edit-form")).toBeInTheDocument();
    });
    expect(screen.getByTestId("display-name-input")).toBeInTheDocument();
    expect(screen.getByTestId("save-button")).toBeInTheDocument();
    expect(screen.queryByTestId("profile-read-only")).not.toBeInTheDocument();
  });

  it("viewer sees read-only profile display (no form)", async () => {
    vi.mocked(useSession).mockReturnValue(viewerSession);
    vi.mocked(useOrganisationProfile).mockReturnValue({
      data: mockProfile,
      isLoading: false,
      isError: false,
    } as ReturnType<typeof useOrganisationProfile>);
    vi.mocked(useUpdateOrganisationProfile).mockReturnValue(
      idleMutation as unknown as ReturnType<typeof useUpdateOrganisationProfile>
    );

    render(<OrganisationProfilePage />);

    await waitFor(() => {
      expect(screen.getByTestId("profile-read-only")).toBeInTheDocument();
    });
    expect(screen.getByTestId("display-name-value")).toHaveTextContent("Fixture Organisation");
    expect(screen.queryByTestId("profile-edit-form")).not.toBeInTheDocument();
  });

  it("unauthenticated session renders no profile (actor is null)", () => {
    vi.mocked(useSession).mockReturnValue(noSession);
    vi.mocked(useOrganisationProfile).mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
    } as ReturnType<typeof useOrganisationProfile>);
    vi.mocked(useUpdateOrganisationProfile).mockReturnValue(
      idleMutation as unknown as ReturnType<typeof useUpdateOrganisationProfile>
    );

    render(<OrganisationProfilePage />);
    // Profile is in error state — error message shown; no edit form or read-only view
    expect(screen.getByText(/could not load profile/i)).toBeInTheDocument();
    expect(screen.queryByTestId("profile-edit-form")).not.toBeInTheDocument();
    expect(screen.queryByTestId("profile-read-only")).not.toBeInTheDocument();
  });

  it("update mutation is called with form data when save is clicked", async () => {
    const mutateMock = vi.fn();
    vi.mocked(useSession).mockReturnValue(adminSession);
    vi.mocked(useOrganisationProfile).mockReturnValue({
      data: mockProfile,
      isLoading: false,
      isError: false,
    } as ReturnType<typeof useOrganisationProfile>);
    vi.mocked(useUpdateOrganisationProfile).mockReturnValue({
      ...idleMutation,
      mutate: mutateMock,
    } as unknown as ReturnType<typeof useUpdateOrganisationProfile>);

    const user = userEvent.setup();
    render(<OrganisationProfilePage />);

    const input = await screen.findByTestId("display-name-input");
    await user.clear(input);
    await user.type(input, "New Display Name");
    await user.click(screen.getByTestId("save-button"));

    await waitFor(() => {
      expect(mutateMock).toHaveBeenCalledWith({ displayName: "New Display Name" });
    });
  });

  it("profile page has no accessibility violations", async () => {
    vi.mocked(useSession).mockReturnValue(adminSession);
    vi.mocked(useOrganisationProfile).mockReturnValue({
      data: mockProfile,
      isLoading: false,
      isError: false,
    } as ReturnType<typeof useOrganisationProfile>);
    vi.mocked(useUpdateOrganisationProfile).mockReturnValue(
      idleMutation as unknown as ReturnType<typeof useUpdateOrganisationProfile>
    );

    const { container } = render(<OrganisationProfilePage />);
    await waitFor(() => {
      expect(screen.getByTestId("profile-edit-form")).toBeInTheDocument();
    });
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
