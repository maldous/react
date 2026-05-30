import enGB from "../locales/en-GB.json" with { type: "json" };

export const packageName = "@platform/i18n-runtime";
export { enGB };

/**
 * Nested JSON locale resource (the shape of committed locale JSON files).
 * e.g. { "feature": { "organisation": { "profile": { "title": "..." } } } }
 */
export type I18nLocaleResource = Record<string, unknown>;

/**
 * Flat map of dot-separated translation keys to template strings.
 * This is the resolved/internal format used by the resolver.
 */
export type I18nMessages = Record<string, string>;

/**
 * Accepted input: either a pre-flattened map or a nested JSON resource.
 * createI18n normalises both to I18nMessages internally.
 */
export type I18nLocaleInput = I18nMessages | I18nLocaleResource;

/** Named interpolation parameters. Values are auto-escaped for HTML safety. */
export type I18nParams = Record<string, string | number>;

/** @deprecated Use I18nMessages. I18nLocale kept for backward compatibility. */
export type I18nLocale = I18nMessages;

/**
 * Flatten a nested JSON locale resource into dot-separated keys.
 * { feature: { title: "x" } } ? { "feature.title": "x" }
 * Already-flat maps are returned unchanged.
 */
export function flattenLocaleMessages(resource: I18nLocaleInput, prefix = ""): I18nMessages {
  const result: I18nMessages = {};
  for (const [k, v] of Object.entries(resource)) {
    const full = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") {
      result[full] = v;
    } else if (typeof v === "object" && v !== null && !Array.isArray(v)) {
      Object.assign(result, flattenLocaleMessages(v as I18nLocaleResource, full));
    }
  }
  return result;
}

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
  /** Flat or nested locale messages ? createI18n normalises both. */
  messages: I18nLocaleInput;
  /** Fallback locale (flat or nested) ? used when a key is missing from the primary. */
  fallback?: I18nLocaleInput;
}

/**
 * Create a typed i18n instance.
 *
 * Accepts both nested JSON locale resources (e.g. imported en-GB.json)
 * and flat dot-separated maps (e.g. test fixtures). Both are normalised
 * to flat I18nMessages internally.
 *
 * Resolution order:
 *  1. messages[key]  (primary locale)
 *  2. fallback[key]  (fallback locale ? typically en-GB)
 *  3. key itself     (missing key ? reported by ADR-ACT-0123 validation gate)
 */
export function createI18n(options: CreateI18nOptions): I18nInstance {
  const messages = flattenLocaleMessages(options.messages);
  const fallback = options.fallback ? flattenLocaleMessages(options.fallback) : undefined;

  function t(key: string, params?: I18nParams): string {
    const template = messages[key] ?? fallback?.[key] ?? key;
    if (!params) return template;
    return interpolate(template, params);
  }

  return { t };
}

/**
 * Server-side helper for BFF/API user-safe messages.
 * Accepts nested or flat locale input; normalises internally.
 */
export function serverT(messages: I18nLocaleInput, key: string, params?: I18nParams): string {
  const flat = flattenLocaleMessages(messages);
  const template = flat[key] ?? key;
  if (!params) return template;
  return interpolate(template, params);
}

export { I18nProvider, useTranslation, createReactI18n } from "./react.ts";
