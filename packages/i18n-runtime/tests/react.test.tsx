/**
 * React integration tests for i18n-runtime (vitest/jsdom)
 *
 * Tests: provider existence, hooks outside provider, useMessage,
 * LocalizedText component, ICU plural/select in React context, locale fallback.
 *
 * Every hook and component must be inside an <I18nProvider> — there is no
 * silent default instance in any environment.
 */

import { createElement, act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { I18nProvider, useI18n, useTranslation, useMessage, LocalizedText } from "../src/react.ts";
import type { I18nMessages } from "../src/index.ts";

// ── jsdom bootstrap ─────────────────────────────────────────────────────────

let root: Root;
let container: HTMLElement;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  document.body.removeChild(container);
});

function render(node: ReactNode): HTMLElement {
  act(() => {
    root.render(node);
  });
  return container;
}

// ── Test fixtures ───────────────────────────────────────────────────────────

const EN_GB_FLAT: I18nMessages = {
  greeting: "Hello",
  farewell: "Goodbye {name}",
  "items.count": "{count, plural, one {# item} other {# items}}",
  "auth.greeting": "{gender, select, male {Welcome, sir} female {Welcome, madam} other {Welcome}}",
};

function captureError(fn: () => void): Error | null {
  try {
    fn();
    return null;
  } catch (e) {
    return e as Error;
  }
}

// ── Provider wrapper helper ─────────────────────────────────────────────────

function wrapInProvider(locale: string, messages: I18nMessages, ...children: ReactNode[]) {
  return createElement(I18nProvider, { locale, messages }, ...children);
}

// ── useI18n ─────────────────────────────────────────────────────────────────

describe("useI18n", () => {
  it("throws when called outside I18nProvider in every environment", () => {
    function BadComponent() {
      useI18n();
      return createElement("div", null, "ok");
    }
    const err = captureError(() => render(createElement(BadComponent)));
    expect(err).toBeTruthy();
    expect(err!.message).toContain("outside an <I18nProvider>");
  });

  it("returns the i18n instance when inside provider", () => {
    let captured: unknown = null;
    function GoodComponent() {
      captured = useI18n();
      return createElement("div", null, "ok");
    }
    render(
      createElement(
        I18nProvider,
        { locale: "en-GB", messages: EN_GB_FLAT },
        createElement(GoodComponent)
      )
    );
    expect(captured).toBeTruthy();
    expect(typeof (captured as Record<string, unknown>).t).toBe("function");
    expect((captured as Record<string, unknown>).locale).toBe("en-GB");
  });
});

// ── useTranslation ──────────────────────────────────────────────────────────

describe("useTranslation", () => {
  it("throws when called outside I18nProvider", () => {
    function BadComponent() {
      useTranslation();
      return createElement("div", null, "ok");
    }
    const err = captureError(() => render(createElement(BadComponent)));
    expect(err).toBeTruthy();
    expect(err!.message).toContain("outside an <I18nProvider>");
  });

  it("returns t() function that resolves keys", () => {
    let result = "";
    function GoodComponent() {
      const t = useTranslation();
      result = t("greeting");
      return createElement("div", null, result);
    }
    render(wrapInProvider("en-GB", EN_GB_FLAT, createElement(GoodComponent)));
    expect(result).toBe("Hello");
  });

  it("interpolates parameters via t()", () => {
    let result = "";
    function GoodComponent() {
      const t = useTranslation();
      result = t("farewell", { name: "Alice" });
      return createElement("div", null, result);
    }
    render(wrapInProvider("en-GB", EN_GB_FLAT, createElement(GoodComponent)));
    expect(result).toBe("Goodbye Alice");
  });
});

// ── useMessage ──────────────────────────────────────────────────────────────

describe("useMessage", () => {
  it("throws when called outside I18nProvider", () => {
    function BadComponent() {
      useMessage("greeting");
      return createElement("div", null, "ok");
    }
    const err = captureError(() => render(createElement(BadComponent)));
    expect(err).toBeTruthy();
    expect(err!.message).toContain("outside an <I18nProvider>");
  });

  it("resolves a single message key", () => {
    let result = "";
    function GoodComponent() {
      result = useMessage("greeting");
      return createElement("div", null, result);
    }
    render(wrapInProvider("en-GB", EN_GB_FLAT, createElement(GoodComponent)));
    expect(result).toBe("Hello");
  });

  it("supports ICU plural", () => {
    let result = "";
    function GoodComponent() {
      result = useMessage("items.count", { count: 3 });
      return createElement("div", null, result);
    }
    render(wrapInProvider("en-GB", EN_GB_FLAT, createElement(GoodComponent)));
    expect(result).toBe("3 items");
  });

  it("supports ICU select", () => {
    let result = "";
    function GoodComponent() {
      result = useMessage("auth.greeting", { gender: "male" });
      return createElement("div", null, result);
    }
    render(wrapInProvider("en-GB", EN_GB_FLAT, createElement(GoodComponent)));
    expect(result).toBe("Welcome, sir");
  });
});

// ── LocalizedText ───────────────────────────────────────────────────────────

describe("LocalizedText", () => {
  it("renders a localized message as a span", () => {
    render(wrapInProvider("en-GB", EN_GB_FLAT, createElement(LocalizedText, { k: "greeting" })));
    const span = container.querySelector("span");
    expect(span).toBeTruthy();
    expect(span!.textContent).toBe("Hello");
  });

  it("renders with interpolated params", () => {
    render(
      wrapInProvider(
        "en-GB",
        EN_GB_FLAT,
        createElement(LocalizedText, { k: "farewell", params: { name: "Charlie" } })
      )
    );
    expect(container.querySelector("span")!.textContent).toBe("Goodbye Charlie");
  });

  it("respects the `as` prop", () => {
    render(
      wrapInProvider("en-GB", EN_GB_FLAT, createElement(LocalizedText, { k: "greeting", as: "h1" }))
    );
    expect(container.querySelector("h1")).toBeTruthy();
    expect(container.querySelector("h1")!.textContent).toBe("Hello");
  });

  it("supports ICU plural in LocalizedText", () => {
    render(
      wrapInProvider(
        "en-GB",
        EN_GB_FLAT,
        createElement(LocalizedText, { k: "items.count", params: { count: 5 } })
      )
    );
    expect(container.querySelector("span")!.textContent).toBe("5 items");
  });

  it("falls through to 'other' when no params for select", () => {
    render(
      wrapInProvider("en-GB", EN_GB_FLAT, createElement(LocalizedText, { k: "auth.greeting" }))
    );
    expect(container.querySelector("span")!.textContent).toBe("Welcome");
  });
});

// ── Locale fallback ─────────────────────────────────────────────────────────

describe("locale fallback", () => {
  it("falls back when key missing in primary locale", () => {
    const frMessages: I18nMessages = { greeting: "Bonjour" };
    let result = "";
    function GoodComponent() {
      result = useMessage("farewell", { name: "David" });
      return createElement("div", null, result);
    }
    render(
      createElement(
        I18nProvider,
        {
          locale: "fr-FR",
          messages: frMessages,
          fallback: EN_GB_FLAT,
        },
        createElement(GoodComponent)
      )
    );
    expect(result).toBe("Goodbye David");
  });

  it("prefers primary locale over fallback", () => {
    const frMessages: I18nMessages = { greeting: "Bonjour" };
    let result = "";
    function GoodComponent() {
      result = useMessage("greeting");
      return createElement("div", null, result);
    }
    render(
      createElement(
        I18nProvider,
        {
          locale: "fr-FR",
          messages: frMessages,
          fallback: EN_GB_FLAT,
        },
        createElement(GoodComponent)
      )
    );
    expect(result).toBe("Bonjour");
  });
});

// ── XSS safety ──────────────────────────────────────────────────────────────

describe("XSS safety", () => {
  it("escapes HTML in interpolated values", () => {
    let result = "";
    function GoodComponent() {
      result = useMessage("farewell", { name: "<script>alert(1)</script>" });
      return createElement("div", null, result);
    }
    render(wrapInProvider("en-GB", EN_GB_FLAT, createElement(GoodComponent)));
    expect(result).not.toContain("<script>");
    expect(result).toContain("&lt;script&gt;");
  });
});
