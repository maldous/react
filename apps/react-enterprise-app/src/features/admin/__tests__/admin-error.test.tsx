import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { I18nProvider, enGB } from "@platform/i18n-runtime";
import type { ReactNode } from "react";
import { classifyAdminError } from "../admin-error";
import { AdminQueryError } from "../AdminQueryError";

const err = (status?: number, code?: string) => Object.assign(new Error("boom"), { status, code });

describe("classifyAdminError", () => {
  it("distinguishes 401 / 403 / NO_CREDENTIAL / generic", () => {
    expect(classifyAdminError(err(401))).toBe("unauthorized");
    expect(classifyAdminError(err(403))).toBe("forbidden");
    expect(classifyAdminError(err(503, "NO_CREDENTIAL"))).toBe("not_configured");
    expect(classifyAdminError(err(503))).toBe("error"); // bare 503 outage, not "not configured"
    expect(classifyAdminError(err(500))).toBe("error");
    expect(classifyAdminError(null)).toBe("error");
  });
});

function renderErr(error: unknown) {
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <I18nProvider locale="en-GB" messages={enGB}>
        {children}
      </I18nProvider>
    );
  }
  return render(<AdminQueryError error={error} />, { wrapper: Wrapper });
}

describe("AdminQueryError", () => {
  it("401 → session-expired state with a sign-in link", () => {
    renderErr(err(401));
    expect(screen.getByTestId("admin-error-unauthorized")).toBeInTheDocument();
    expect(screen.getByTestId("admin-error-signin")).toHaveAttribute("href", "/login");
  });

  it("403 → forbidden state", () => {
    renderErr(err(403));
    expect(screen.getByTestId("admin-error-forbidden")).toBeInTheDocument();
  });

  it("503 NO_CREDENTIAL → not-configured state", () => {
    renderErr(err(503, "NO_CREDENTIAL"));
    expect(screen.getByTestId("admin-error-not_configured")).toBeInTheDocument();
  });

  it("generic failure → retryable error state", () => {
    renderErr(err(500));
    expect(screen.getByTestId("admin-error-error")).toBeInTheDocument();
  });
});
