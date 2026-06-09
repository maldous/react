import { z } from "zod";

// Browser-safe tenant theme contract (ADR-0029 per-tenant branding). The BFF
// /api/theme endpoint is unauthenticated and tenant-scoped; it always returns a
// usable theme (its own default when a tenant has no branding). The SPA cannot
// import the server-side TenantTheme type (ADR-0022), so this is the browser
// contract — validated at runtime so a malformed/hostile payload can never reach
// the DOM.

// Strict colour allow-list: 3/6/8-digit hex only. Anything else is rejected and
// the default is used — this is the guard against CSS injection via theme values.
const HEX_COLOUR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

// Only same-scheme https(s) URLs may reach an <img src>/<link href>.
const isSafeHttpUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
};

export const ThemeSchema = z.object({
  displayName: z.string().min(1).max(120),
  primaryColour: z.string().regex(HEX_COLOUR),
  logoUrl: z.string().refine(isSafeHttpUrl, "logoUrl must be an http(s) URL").nullable(),
  faviconUrl: z.string().refine(isSafeHttpUrl, "faviconUrl must be an http(s) URL").nullable(),
});

export type Theme = z.infer<typeof ThemeSchema>;

/** Default theme — mirrors the BFF DEFAULT_THEME and the @theme token defaults. */
export const DEFAULT_THEME: Theme = {
  displayName: "Enterprise Platform",
  primaryColour: "#4f46e5",
  logoUrl: null,
  faviconUrl: null,
};

/**
 * Parse an unknown /api/theme payload into a safe Theme, falling back to the
 * default on any validation failure. Never throws — branding must always resolve.
 */
export function parseTheme(payload: unknown): Theme {
  const result = ThemeSchema.safeParse(payload);
  return result.success ? result.data : DEFAULT_THEME;
}

/**
 * Apply a validated theme to the document as CSS custom properties. Only the
 * brand colour is written (the hover shade and every *-primary utility derive
 * from it via globals.css). No-op outside a DOM (SSR/tests without document).
 */
export function applyThemeToDocument(theme: Theme, root?: HTMLElement): void {
  const target = root ?? globalThis.document?.documentElement;
  if (!target) return;
  // primaryColour is already hex-validated by the schema, but guard again so a
  // direct caller cannot bypass the allow-list.
  if (HEX_COLOUR.test(theme.primaryColour)) {
    target.style.setProperty("--color-primary", theme.primaryColour);
  }
}
