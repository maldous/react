export const packageName = "@platform/i18n-runtime";

/** Flat map of dot-separated translation keys to template strings. */
export type I18nLocale = Record<string, string>;

/** Named interpolation parameters. Values are auto-escaped for HTML safety. */
export type I18nParams = Record<string, string | number>;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function interpolate(template: string, params: I18nParams): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => {
    const value = params[key];
    if (value === undefined) return `{${key}}`;
    return escapeHtml(String(value));
  });
}

export interface I18nInstance {
  t(key: string, params?: I18nParams): string;
}

export interface CreateI18nOptions {
  locale: string;
  messages: I18nLocale;
  /** Fallback locale messages — used when a key is missing from the primary locale. */
  fallback?: I18nLocale;
}

/**
 * Create a typed i18n instance. Resolution order:
 *  1. messages[key]  (primary locale)
 *  2. fallback[key]  (fallback locale — typically en-GB)
 *  3. key itself     (missing key — reported by ADR-ACT-0123 validation gate)
 */
export function createI18n(options: CreateI18nOptions): I18nInstance {
  const { messages, fallback } = options;

  function t(key: string, params?: I18nParams): string {
    const template = messages[key] ?? fallback?.[key] ?? key;
    if (!params) return template;
    return interpolate(template, params);
  }

  return { t };
}

/**
 * Server-side helper for BFF/API user-safe messages.
 * Resolves a translation key from the provided locale map.
 * Falls back to returning the key itself if missing.
 */
export function serverT(messages: I18nLocale, key: string, params?: I18nParams): string {
  const template = messages[key] ?? key;
  if (!params) return template;
  return interpolate(template, params);
}
