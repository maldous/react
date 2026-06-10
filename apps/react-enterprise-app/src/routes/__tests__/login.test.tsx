import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { axe } from "vitest-axe";
import { I18nProvider, enGB } from "@platform/i18n-runtime";
import type { ReactNode } from "react";
import { LoginPage } from "../login";

/*
 * Login entry tests (ADR-ACT-0157). Keycloak is the single login surface, so /login
 * either hands straight off to the BFF login start (no ?authError) or shows ONE generic
 * error + a retry button (with ?authError). No app-side provider chooser.
 */
function renderLogin() {
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <I18nProvider locale="en-GB" messages={enGB}>
        {children}
      </I18nProvider>
    );
  }
  return render(<LoginPage />, { wrapper: Wrapper });
}

describe("LoginPage", () => {
  const originalLocation = window.location;
  let replace: ReturnType<typeof vi.fn>;

  function stubLocation(search: string) {
    replace = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { search, href: `http://localhost/login${search}`, replace },
    });
  }

  afterEach(() => {
    Object.defineProperty(window, "location", { configurable: true, value: originalLocation });
  });

  it("hands straight off to the Keycloak login when there is no error", async () => {
    stubLocation("");
    renderLogin();
    expect(screen.getByTestId("login-redirecting")).toBeInTheDocument();
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/auth/login?provider=platform"));
  });

  it("shows one generic error + a retry button on ?authError and does NOT redirect", () => {
    stubLocation("?authError=signin_failed");
    renderLogin();
    expect(screen.getByTestId("login-auth-error")).toBeInTheDocument();
    expect(screen.getByText("Sign-in failed. Please try again.")).toBeInTheDocument();
    expect(screen.getByTestId("sign-in-button")).toHaveAttribute(
      "href",
      "/auth/login?provider=platform"
    );
    expect(replace).not.toHaveBeenCalled();
  });

  it("shows the same generic error regardless of the authError code", () => {
    stubLocation("?authError=email_unverified");
    renderLogin();
    expect(screen.getByText("Sign-in failed. Please try again.")).toBeInTheDocument();
  });

  it("has no accessibility violations in the error state", async () => {
    stubLocation("?authError=signin_failed");
    const { container } = renderLogin();
    await waitFor(async () => expect(await axe(container)).toHaveNoViolations());
  });
});
