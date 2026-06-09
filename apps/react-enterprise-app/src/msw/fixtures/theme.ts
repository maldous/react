// Theme fixtures for frontend tests (ADR-0029 per-tenant branding). The runtime
// theme contract + schema live in src/theme; these fixtures intentionally use a
// structural shape so the MSW layer has no dependency cycle with the theme
// module. Values mirror the BFF DEFAULT_THEME and a representative tenant brand.

export interface ThemeFixture {
  displayName: string;
  primaryColour: string;
  logoUrl: string | null;
  faviconUrl: string | null;
}

export const defaultThemeFixture: ThemeFixture = {
  displayName: "Enterprise Platform",
  primaryColour: "#4f46e5",
  logoUrl: null,
  faviconUrl: null,
};

export const tenantThemeFixture: ThemeFixture = {
  displayName: "Acme Corporation",
  primaryColour: "#0f766e",
  logoUrl: "https://cdn.example.test/acme/logo.svg",
  faviconUrl: "https://cdn.example.test/acme/favicon.ico",
};
