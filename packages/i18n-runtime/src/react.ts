/**
 * @platform/i18n-runtime/react — React provider/hook boundary (ADR-0026)
 *
 * Separate entry point so server-side code (BFF/API) can import from
 * @platform/i18n-runtime without pulling in React as a dependency.
 *
 * Usage:
 *   import { I18nProvider, useTranslation } from "@platform/i18n-runtime/react";
 *
 * This module satisfies the ADR-0026 §Runtime model requirement:
 *   "expose a React provider/hook for UI code"
 *
 * Full implementation (React context, useTranslation hook) is tracked in
 * ADR-ACT-0121. This baseline exports the type contract and a placeholder
 * so consuming code can import from the correct entry point now.
 */

import { createI18n, type I18nInstance, type I18nLocale, type CreateI18nOptions } from "./index.ts";

export type { I18nInstance, I18nLocale, CreateI18nOptions };

/**
 * Placeholder React provider type contract.
 * Replace with real React context implementation in ADR-ACT-0121.
 */
export interface I18nProviderProps {
  locale: string;
  messages: I18nLocale;
  fallback?: I18nLocale;
  children: unknown; // typed as unknown to avoid React peer-dep at this layer
}

/**
 * Create an i18n instance scoped for a React component tree.
 * This is the bootstrap call — in the full implementation (ADR-ACT-0121)
 * this will be wrapped in a React Context so child components can call
 * useTranslation() without explicit prop threading.
 */
export function createReactI18n(options: CreateI18nOptions): I18nInstance {
  return createI18n(options);
}
