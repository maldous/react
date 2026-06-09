import "@testing-library/jest-dom";
import { configureAxe } from "vitest-axe";
import "vitest-axe/extend-expect";
import { afterAll, afterEach, beforeAll } from "vitest";
import { server } from "./msw/server.ts";

configureAxe({
  rules: {
    // allow region landmark rule to be less strict during testing
    region: { enabled: false },
  },
});

// Global MSW lifecycle (ADR-0019). Every test runs against the baseline handler
// set; tests override per-case with server.use(...). Unhandled API calls fail
// loudly so a missing mock is a test error, while asset/other requests pass
// through (jsdom, vite-transformed modules, etc.).
beforeAll(() =>
  server.listen({
    onUnhandledRequest(request, print) {
      const { pathname } = new URL(request.url);
      if (
        pathname.startsWith("/api/") ||
        pathname === "/healthz" ||
        pathname === "/readyz" ||
        pathname === "/version"
      ) {
        print.error();
      }
    },
  })
);
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
