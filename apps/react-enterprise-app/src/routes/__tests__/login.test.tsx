import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { axe } from "vitest-axe";
import { I18nProvider, enGB } from "@platform/i18n-runtime";
import type { ReactNode } from "react";
import { LoginPage } from "../login";

/*
 * Login entry tests (ADR-ACT-0157). Keycloak is the single login surface, but /login
 * keeps a visible CTA that hands off to the BFF login start. With ?authError it shows
 * one generic error and a retry button. No app-side provider chooser.
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
    expect(screen.getByText("Loading sign-in options…")).toBeInTheDocument();
    expect(screen.getByTestId("sign-in-button")).toHaveAttribute(
      "href",
      "/auth/login?provider=platform"
    );
    expect(replace).not.toHaveBeenCalled();
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
