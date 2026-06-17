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
  adminStorageReadinessHandler,
  adminStorageProbeHandler,
} from "../../../msw";
import { AdminStoragePage } from "../AdminStoragePage";

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
  return render(<AdminStoragePage />, { wrapper: Wrapper });
}

describe("AdminStoragePage (ADR-0049)", () => {
  it("renders readiness banner, prefix, and isolation status", async () => {
    server.use(sessionHandler("tenantAdmin"), adminStorageReadinessHandler());
    renderPage();
    expect(await screen.findByTestId("admin-storage-readiness-badge")).toHaveTextContent(
      "configured"
    );
    expect(screen.getByTestId("admin-storage-readiness-text")).not.toBeEmptyDOMElement();
    expect(screen.getByTestId("admin-storage-prefix")).toHaveTextContent(
      "00000000-0000-4000-8000-000000000001/"
    );
    expect(screen.getByTestId("admin-storage-isolation")).toHaveTextContent(/enforced/i);
  });

  it("runs the probe and announces probeDone (write permission)", async () => {
    server.use(
      sessionHandler("tenantAdmin"),
      adminStorageReadinessHandler(),
      adminStorageProbeHandler()
    );
    renderPage();
    const probeBtn = await screen.findByTestId("admin-storage-probe-button");
    await userEvent.click(probeBtn);
    await waitFor(() =>
      expect(screen.getByTestId("admin-storage-probe-announce")).not.toBeEmptyDOMElement()
    );
    expect(screen.getByTestId("admin-storage-probe-announce")).toHaveTextContent(/probe complete/i);
  });

  it("hides the probe button without write permission (viewer)", async () => {
    server.use(sessionHandler("viewer"), adminStorageReadinessHandler());
    renderPage();
    await screen.findByTestId("admin-storage");
    expect(screen.queryByTestId("admin-storage-probe-button")).not.toBeInTheDocument();
  });

  it("has no accessibility violations", async () => {
    server.use(sessionHandler("tenantAdmin"), adminStorageReadinessHandler());
    const { container } = renderPage();
    await screen.findByTestId("admin-storage");
    expect(await axe(container)).toHaveNoViolations();
  });
});
