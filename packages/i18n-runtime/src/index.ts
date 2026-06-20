import enGB from "../locales/en-GB.json" with { type: "json" };

export const packageName = "@platform/i18n-runtime";
export { enGB };

// ── Types ───────────────────────────────────────────────────────────────────

/** Nested JSON locale resource (the shape of committed locale JSON files). */
export type I18nLocaleResource = Record<string, unknown>;

/** Flat map of dot-separated translation keys to template strings. */
export type I18nMessages = Record<string, string>;

/** Accepted input: either a pre-flattened map or a nested JSON resource. */
export type I18nLocaleInput = I18nMessages | I18nLocaleResource;

/**
 * Named interpolation parameters. Values are auto-escaped for HTML safety.
 * Values can be strings, numbers, or nested objects for ICU plural/select.
 */
export type I18nParams = Record<string, string | number>;

/**
 * Canonical message key type — derived from the committed en-GB.json catalogue.
 *
 * Every key in the catalogue is a valid MessageKey. The validate-i18n gate
 * enforces that only keys from the canonical catalogue are used in product code.
 */
type Join<K, P> = K extends string | number
  ? P extends string | number
    ? `${K}${P extends "" ? "" : "."}${P}`
    : never
  : never;
type Paths<T> = T extends object
  ? {
      [K in keyof T]-?: K extends string ? `${K}` | Join<K, Paths<T[K]>> : never;
    }[keyof T]
  : "";
export type MessageKey = Paths<typeof enGB>;

// ── Flatten ─────────────────────────────────────────────────────────────────

/**
 * Flatten a nested JSON locale resource into dot-separated keys.
 * Already-flat maps are returned unchanged.
 */
// NOSONAR - recursive JSON flatten is inherently complex
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

// ── HTML escaping ───────────────────────────────────────────────────────────

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ── ICU plural rules (CLDR subset) ──────────────────────────────────────────

/**
 * Minimal CLDR plural rule evaluation for English and common European languages
 * (cardinal: one=1, other=everything-else). For locales with more complex rules
 * (Arabic, Russian, etc.), extend this function with locale-specific logic.
 */
function pluralCategory(value: number, locale: string): string {
  // English-style rules: one if exactly 1, otherwise other
  if (
    locale.startsWith("en") ||
    locale.startsWith("de") ||
    locale.startsWith("es") ||
    locale.startsWith("fr") ||
    locale.startsWith("it") ||
    locale.startsWith("pt") ||
    locale.startsWith("nl")
  ) {
    return value === 1 ? "one" : "other";
  }

  // Russian-style: one=1, few=2-4, many=5-20, other
  if (locale.startsWith("ru") || locale.startsWith("uk")) {
    const mod10 = value % 10;
    const mod100 = value % 100;
    if (mod10 === 1 && mod100 !== 11) return "one";
    if (mod10 >= 2 && mod10 <= 4 && !(mod100 >= 12 && mod100 <= 14)) return "few";
    return "many";
  }

  // Irish / Scottish Gaelic: one=1, two=2, few=3-6, many=7-10, other
  if (locale.startsWith("ga") || locale.startsWith("gd")) {
    if (value === 1) return "one";
    if (value === 2) return "two";
    if (value >= 3 && value <= 6) return "few";
    if (value >= 7 && value <= 10) return "many";
    return "other";
  }

  // Default: English-style
  return value === 1 ? "one" : "other";
}

// ── Safe record access (noUncheckedIndexedAccess) ─────────────────────────

function recGet(rec: Record<string, string>, key: string): string | undefined {
  return rec[key];
}

// ── ICU message interpolation ───────────────────────────────────────────────

/**
 * Parse and evaluate an ICU message template with plural and select support.
 *
 * Uses a character-by-character scanner to handle nested braces within
 * ICU plural/select blocks — a regex-based approach cannot correctly match
 * balanced braces in a single pass.
 *
 * Supported syntax:
 *   {key}                          → escaped param value
 *   {key, plural, one {…} other {…}} → plural form selection
 *   {key, select, male {…} female {…} other {…}} → select form
 *
 * Nested plural/select and nested interpolation within blocks are supported.
 * Unmatched keys are left as-is in the template (observable but safe).
 */
function interpolateIcu(template: string, params: I18nParams, locale: string): string { // NOSONAR
  // Fast path: no opening brace
  if (!template.includes("{")) return template;

  let result = "";
  let pos = 0;
  const len = template.length;

  while (pos < len) {
    const braceIdx = template.indexOf("{", pos);
    if (braceIdx === -1) {
      result += template.slice(pos);
      break;
    }

    // Copy literal text before the brace
    result += template.slice(pos, braceIdx);

    // Extract key + optional ICU type by scanning past balanced braces
    const parsed = parseIcuExpression(template, braceIdx);
    if (!parsed) {
      // Unparseable — treat as literal
      result += "{";
      pos = braceIdx + 1;
      continue;
    }

    pos = parsed.endPos;

    if (parsed.type === "simple") {
      const value = params[parsed.key];
      if (value === undefined) {
        result += `{${parsed.key}}`;
      } else {
        result += escapeHtml(String(value));
      }
    } else if (parsed.type === "plural") {
      const paramValue = params[parsed.key];
      const numericValue = typeof paramValue === "number" ? paramValue : Number(paramValue);
      if (Number.isNaN(numericValue)) {
        const otherBlock = recGet(parsed.blocks, "other");
        if (otherBlock !== undefined) {
          result += interpolateIcu(otherBlock, params, locale);
        } else {
          result += String(paramValue ?? `{${parsed.key}}`);
        }
      } else {
        const category = pluralCategory(numericValue, locale);
        const exactKey = `=${numericValue}`;
        const blockContent =
          recGet(parsed.blocks, exactKey) ??
          recGet(parsed.blocks, category) ??
          recGet(parsed.blocks, "other");
        if (blockContent !== undefined) {
          // Replace `#` with the numeric value (ICU plural shorthand),
          // then interpolate any remaining {key} placeholders within the block.
          const withHash = blockContent.replace(/#/g, String(numericValue));
          result += interpolateIcu(withHash, params, locale);
        } else {
          result += String(numericValue);
        }
      }
    } else if (parsed.type === "select") {
      const paramValue = params[parsed.key];
      const selectValue = String(paramValue ?? "other");
      const blockContent = recGet(parsed.blocks, selectValue) ?? recGet(parsed.blocks, "other");
      if (blockContent !== undefined) {
        result += interpolateIcu(blockContent, params, locale);
      } else {
        result += String(paramValue ?? `{${parsed.key}}`);
      }
    } else {
      // Unknown ICU type — leave as-is
      result += `{${parsed.key}}`;
    }
  }

  return result;
}

interface IcuExpression {
  key: string;
  type: "simple" | "plural" | "select" | "unknown";
  blocks: Record<string, string>;
  endPos: number;
}

/**
 * Parse an ICU expression starting at the `{` at position `braceIdx`.
 * Returns null if the expression is malformed (no matching closing brace).
 */
function parseIcuExpression(template: string, braceIdx: number): IcuExpression | null { // NOSONAR
  const len = template.length;
  let pos = braceIdx + 1; // skip '{'

  // Read key: word characters only
  const keyStart = pos;
  while (pos < len && /\w/.test(template.charAt(pos))) pos++;
  const key = template.slice(keyStart, pos);
  if (!key) return null;

  // Skip whitespace after key
  while (pos < len && /\s/.test(template.charAt(pos))) pos++;

  // Check for ICU type: comma + plural/select
  if (pos >= len || template.charAt(pos) !== ",") {
    // Simple interpolation: {key}
    if (pos < len && template.charAt(pos) === "}") {
      return { key, type: "simple", blocks: {}, endPos: pos + 1 };
    }
    // Skip whitespace, expect `}`
    while (pos < len && /\s/.test(template.charAt(pos))) pos++;
    if (pos < len && template.charAt(pos) === "}") {
      return { key, type: "simple", blocks: {}, endPos: pos + 1 };
    }
    return null;
  }

  pos++; // skip comma

  // Skip whitespace after comma
  while (pos < len && /\s/.test(template.charAt(pos))) pos++;

  // Read ICU type: "plural" or "select"
  const typeStart = pos;
  while (pos < len && /\w/.test(template.charAt(pos))) pos++;
  const icuType = template.slice(typeStart, pos);
  if (icuType !== "plural" && icuType !== "select") {
    return { key, type: "unknown", blocks: {}, endPos: pos };
  }

  // Skip whitespace before comma
  while (pos < len && /\s/.test(template.charAt(pos))) pos++;

  // Expect comma before blocks
  if (pos >= len || template.charAt(pos) !== ",") return null;
  pos++;

  // Parse blocks: "one {…} other {…}"
  const blocks = parseIcuBlocksFrom(template, pos);
  pos = blocks.endPos;

  // Skip whitespace before closing }
  while (pos < len && /\s/.test(template.charAt(pos))) pos++;

  // Expect closing }
  if (pos >= len || template.charAt(pos) !== "}") return null;
  pos++;

  return {
    key,
    type: icuType,
    blocks: blocks.map,
    endPos: pos,
  };
}

/**
 * Parse ICU blocks starting at `startPos`. Returns the block map and the
 * position after the last parsed block.
 */
function parseIcuBlocksFrom( // NOSONAR
  source: string,
  startPos: number
): { map: Record<string, string>; endPos: number } {
  const blocks: Record<string, string> = {};
  let pos = startPos;
  const len = source.length;

  while (pos < len) {
    // Skip whitespace
    while (pos < len && /\s/.test(source.charAt(pos))) pos++;
    if (pos >= len) break;

    // If we hit `}`, this is the end of the ICU expression (not a block)
    if (source.charAt(pos) === "}") break;

    // Read category name (word characters or "=" prefix for exact values)
    const catStart = pos;
    if (source.charAt(pos) === "=") {
      pos++;
      while (pos < len && /\d/.test(source.charAt(pos))) pos++;
    } else {
      while (pos < len && /\w/.test(source.charAt(pos))) pos++;
    }
    const category = source.slice(catStart, pos);
    if (!category) break;

    // Skip whitespace before {
    while (pos < len && /\s/.test(source.charAt(pos))) pos++;
    if (pos >= len || source.charAt(pos) !== "{") break;

    // Extract balanced braces for the block content
    const content = extractBalancedBraces(source, pos);
    pos = content.endPos;
    blocks[category] = content.text;
  }

  return { map: blocks, endPos: pos };
}

/**
 * Extract balanced braces: given source[pos] === "{", find matching "}" and
 * return { text, endPos }. Handles nested {…} pairs.
 */
function extractBalancedBraces(source: string, startPos: number): { text: string; endPos: number } {
  let depth = 0;
  let pos = startPos;
  const len = source.length;

  while (pos < len) {
    const ch = source.charAt(pos);
    if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) {
        return { text: source.slice(startPos + 1, pos), endPos: pos + 1 };
      }
    }
    pos++;
  }

  // No matching close — return rest
  return { text: source.slice(startPos + 1), endPos: len };
}

// ── Simple interpolation (non-ICU, backward compat) ─────────────────────────

function interpolateSimple(template: string, params: I18nParams): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => {
    const value = params[key];
    if (value === undefined) return `{${key}}`;
    return escapeHtml(String(value));
  });
}

// ── i18n instance ───────────────────────────────────────────────────────────

export interface I18nInstance {
  /**
   * Resolve a message key to its localized string.
   * Supports ICU plural/select syntax in message templates.
   *
   * Accepts canonical MessageKey (for strict catalogue-bound usage) or any
   * string (for migration / dynamic keys). The validate-i18n gate is the
   * authoritative runtime/build safeguard for unknown keys.
   *
   * Resolution order:
   *   1. Primary locale messages
   *   2. Fallback locale messages
   *   3. The key itself (missing key — observable but safe)
   */
  /**
   * Resolve a message key to its localized string.
   * Accepts canonical MessageKey from the catalogue or any string for
   * migration compatibility. The validate-i18n gate is the authoritative
   * runtime/build safeguard for unknown keys.
   */
  // NOSONAR - MessageKey union provides catalogue-bound autocomplete
  t(key: MessageKey | string, params?: I18nParams): string;
  /** The active BCP 47 locale tag. */
  readonly locale: string;
}

export interface CreateI18nOptions {
  locale: string;
  /** Flat or nested locale messages — createI18n normalises both. */
  messages: I18nLocaleInput;
  /** Fallback locale (flat or nested) — used when a key is missing from the primary. */
  fallback?: I18nLocaleInput;
}

/**
 * Create a typed i18n instance with ICU message formatting.
 *
 * Resolution order:
 *  1. messages[key]  (primary locale)
 *  2. fallback[key]  (fallback locale — typically en-GB)
 *  3. key itself     (missing key — reported by validate-i18n gate)
 */
export function createI18n(options: CreateI18nOptions): I18nInstance {
  const messages = flattenLocaleMessages(options.messages);
  const fallback = options.fallback ? flattenLocaleMessages(options.fallback) : undefined;
  const locale = options.locale;

  function t(key: MessageKey, params?: I18nParams): string {
    const template = recGet(messages, key) ?? (fallback ? recGet(fallback, key) : undefined) ?? key;
    // Always run ICU interpolation if the template contains plural/select
    // markers — even without params, the "other" branch should resolve.
    if (template.includes(", plural,") || template.includes(", select,")) {
      return interpolateIcu(template, params ?? {}, locale);
    }
    if (!params) return template;
    return interpolateSimple(template, params);
  }

  return { t, locale };
}

// ── Server-side helper ──────────────────────────────────────────────────────

/**
 * Server-side helper for BFF/API user-safe messages.
 * Accepts nested or flat locale input; normalises internally.
 */
export function serverT(messages: I18nLocaleInput, key: MessageKey, params?: I18nParams): string {
  const flat = flattenLocaleMessages(messages);
  const template = recGet(flat, key) ?? key;
  if (template.includes(", plural,") || template.includes(", select,")) {
    return interpolateIcu(template, params ?? {}, "en-GB");
  }
  if (!params) return template;
  return interpolateSimple(template, params);
}

// ── React integration (separate entry point) ────────────────────────────────

export { I18nProvider, useTranslation, useMessage, LocalizedText } from "./react.ts";

// Re-export the createReactI18n helper (non-React-bound createI18n alias)
export { createReactI18n } from "./react.ts";
