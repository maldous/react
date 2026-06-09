import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, waitFor, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";
import { server, themeHandler, themeErrorHandler, tenantThemeFixture } from "../../msw";
import { DEFAULT_THEME, parseTheme, applyThemeToDocument } from "../../theme/theme";
import { useThemeQuery } from "../../theme/use-theme";
import { ThemeProvider, useTheme } from "../../theme/ThemeProvider";

function wrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

describe("parseTheme", () => {
  it("accepts a valid tenant theme", () => {
    expect(parseTheme(tenantThemeFixture)).toEqual(tenantThemeFixture);
  });

  it("falls back to the default for a malformed payload", () => {
    expect(parseTheme({ primaryColour: 123 })).toEqual(DEFAULT_THEME);
    expect(parseTheme(null)).toEqual(DEFAULT_THEME);
  });

  it("rejects an unsafe (non-hex) colour to prevent CSS injection", () => {
    const hostile = {
      ...tenantThemeFixture,
      primaryColour: "red; background:url(javascript:alert(1))",
    };
    expect(parseTheme(hostile)).toEqual(DEFAULT_THEME);
  });

  it("rejects a non-http(s) logo URL", () => {
    const hostile = { ...tenantThemeFixture, logoUrl: "javascript:alert(1)" };
    expect(parseTheme(hostile)).toEqual(DEFAULT_THEME);
  });
});

describe("applyThemeToDocument", () => {
  let root: HTMLElement;
  beforeEach(() => {
    root = document.createElement("div");
  });

  it("writes the validated brand colour as a CSS variable", () => {
    applyThemeToDocument({ ...DEFAULT_THEME, primaryColour: "#0f766e" }, root);
    expect(root.style.getPropertyValue("--color-primary")).toBe("#0f766e");
  });

  it("does not write an unsafe colour", () => {
    applyThemeToDocument({ ...DEFAULT_THEME, primaryColour: "evil" }, root);
    expect(root.style.getPropertyValue("--color-primary")).toBe("");
  });
});

describe("useThemeQuery", () => {
  it("returns the tenant theme on success", async () => {
    server.use(themeHandler(tenantThemeFixture));
    const { result } = renderHook(() => useThemeQuery(), { wrapper: wrapper() });
    await waitFor(() =>
      expect(result.current.data?.primaryColour).toBe(tenantThemeFixture.primaryColour)
    );
  });

  it("falls back to the default theme when /api/theme fails", async () => {
    server.use(themeErrorHandler(500));
    const { result } = renderHook(() => useThemeQuery(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isFetched).toBe(true));
    expect(result.current.data).toEqual(DEFAULT_THEME);
  });
});

describe("ThemeProvider", () => {
  it("applies the tenant brand colour to the document and exposes it via useTheme", async () => {
    server.use(themeHandler(tenantThemeFixture));
    function Probe() {
      return <span data-testid="brand">{useTheme().displayName}</span>;
    }
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
      { wrapper: wrapper() }
    );
    await waitFor(() =>
      expect(document.documentElement.style.getPropertyValue("--color-primary")).toBe(
        tenantThemeFixture.primaryColour
      )
    );
    expect(screen.getByTestId("brand")).toHaveTextContent(tenantThemeFixture.displayName);
  });
});
