import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";
import { useSession } from "../hooks/use-session";

const server = setupServer();

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

describe("useSession", () => {
  it("returns authenticated actor when /api/session responds with 200", async () => {
    server.use(
      http.get("/api/session", () =>
        HttpResponse.json({
          userId: "user-1",
          tenantId: "tenant-1",
          organisationId: "org-1",
          roles: ["tenant-admin"],
          permissions: ["organisation.read", "member.read"],
          displayName: "Alice",
        })
      )
    );

    const { result } = renderHook(() => useSession(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.actor).not.toBeNull();
    expect(result.current.actor?.userId).toBe("user-1");
    expect(result.current.actor?.displayName).toBe("Alice");
  });

  it("returns null actor when /api/session responds with 401", async () => {
    server.use(http.get("/api/session", () => new HttpResponse(null, { status: 401 })));

    const { result } = renderHook(() => useSession(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.actor).toBeNull();
  });

  it("hasPermission returns true when permission is present", async () => {
    server.use(
      http.get("/api/session", () =>
        HttpResponse.json({
          userId: "user-2",
          tenantId: "tenant-2",
          organisationId: "org-2",
          roles: ["viewer"],
          permissions: ["profile.read_self", "member.read"],
          displayName: "Bob",
        })
      )
    );

    const { result } = renderHook(() => useSession(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.hasPermission("profile.read_self")).toBe(true);
    expect(result.current.hasPermission("organisation.update")).toBe(false);
  });
});
