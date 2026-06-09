import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { createElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nProvider, enGB } from "@platform/i18n-runtime";
import { AdminLogsPage } from "../../features/admin-logs/AdminLogsPage";
import { DEFAULT_LOG_SEARCH_PARAMS } from "../../features/admin-logs/admin-logs.schema";

const server = setupServer();
beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const ENTRY = {
  timestamp: "2026-06-09T00:00:00.000Z",
  line: '{"msg":"http.request.complete","requestId":"req-1","traceId":"trace-1","level":"info"}',
  fields: { msg: "http.request.complete", requestId: "req-1", traceId: "trace-1", level: "info" },
  labels: { service: "platform-api", level: "info" },
};

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onSearchChange = vi.fn();
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(
      QueryClientProvider,
      { client },
      createElement(I18nProvider, { locale: "en-GB", messages: enGB }, children)
    );
  render(
    <AdminLogsPage
      search={DEFAULT_LOG_SEARCH_PARAMS}
      onSearchChange={onSearchChange}
      now={() => 1_700_000_000_000}
    />,
    { wrapper }
  );
  return { onSearchChange, user: userEvent.setup() };
}

describe("AdminLogsPage", () => {
  it("renders the page shell and prompts before any search", () => {
    renderPage();
    expect(screen.getByTestId("admin-logs-page")).toBeInTheDocument();
    expect(screen.getByTestId("admin-logs-search-form")).toBeInTheDocument();
    // No query before an explicit search: results region shows the prompt, not a table.
    expect(screen.queryByTestId("logs-results")).not.toBeInTheDocument();
  });

  it("submits a search, sends typed filters, and renders results", async () => {
    let capturedUrl = "";
    server.use(
      http.get("/api/admin/logs/search", ({ request }) => {
        capturedUrl = request.url;
        return HttpResponse.json({ entries: [ENTRY] });
      })
    );
    const { user, onSearchChange } = renderPage();

    await user.type(
      within(screen.getByTestId("filter-service")).getByRole("textbox"),
      "platform-api"
    );
    await user.click(screen.getByTestId("logs-search-button"));

    expect(await screen.findByTestId("logs-results")).toBeInTheDocument();
    expect(screen.getAllByTestId("logs-row")).toHaveLength(1);
    expect(onSearchChange).toHaveBeenCalledWith(
      expect.objectContaining({ service: "platform-api" })
    );
    expect(new URL(capturedUrl).searchParams.get("service")).toBe("platform-api");
  });

  it("shows the empty state when no logs match", async () => {
    server.use(http.get("/api/admin/logs/search", () => HttpResponse.json({ entries: [] })));
    const { user } = renderPage();
    await user.click(screen.getByTestId("logs-search-button"));
    expect(await screen.findByText(enGB.feature.adminLogs.empty.title)).toBeInTheDocument();
  });

  it("shows the error state on a failed search", async () => {
    server.use(
      http.get("/api/admin/logs/search", () =>
        HttpResponse.json({ code: "log.search.unavailable" }, { status: 502 })
      )
    );
    const { user } = renderPage();
    await user.click(screen.getByTestId("logs-search-button"));
    expect(await screen.findByText(enGB.feature.adminLogs.error)).toBeInTheDocument();
  });

  it("expands a row to reveal details via an accessible control", async () => {
    server.use(http.get("/api/admin/logs/search", () => HttpResponse.json({ entries: [ENTRY] })));
    const { user } = renderPage();
    await user.click(screen.getByTestId("logs-search-button"));
    await screen.findByTestId("logs-results");

    const expand = screen.getByTestId("logs-row-expand");
    expect(expand).toHaveAttribute("aria-expanded", "false");
    await user.click(expand);
    expect(await screen.findByTestId("logs-row-details")).toBeInTheDocument();
    expect(screen.getByTestId("logs-row-expand")).toHaveAttribute("aria-expanded", "true");
  });

  it("copies the query context (URL + filter state)", async () => {
    const { user, onSearchChange } = renderPage();
    await user.click(screen.getByTestId("logs-copy-context-button"));
    // Copy must not trigger a search submit, and must confirm to the operator.
    expect(onSearchChange).not.toHaveBeenCalled();
    expect(await screen.findByText(enGB.feature.adminLogs.copied)).toBeInTheDocument();
    // user-event provides the clipboard stub; read back what was written.
    const payload = JSON.parse(await navigator.clipboard.readText());
    expect(payload).toHaveProperty("params");
    expect(payload).toHaveProperty("url");
  });

  it("updates a filter field as the operator types", async () => {
    const { user } = renderPage();
    const text = within(screen.getByTestId("filter-text")).getByRole("textbox");
    await user.type(text, "boom");
    expect(text).toHaveValue("boom");
  });
});
