/**
 * @platform/i18n-runtime/react ? React provider/hook boundary (ADR-0026)
 *
 * Separate entry point so server-side code (BFF/API) can import from
 * @platform/i18n-runtime without pulling in React as a dependency.
 *
 * Usage:
 *   import { I18nProvider, useTranslation } from "@platform/i18n-runtime/react";
 *
 * This module satisfies the ADR-0026 ?Runtime model requirement:
 *   "expose a React provider/hook for UI code"
 *
 * Full implementation (React context, useTranslation hook) is tracked in
 * ADR-ACT-0121. This baseline exports the type contract and a placeholder
 * so consuming code can import from the correct entry point now.
 */

import { createContext, createElement, useContext, useMemo, type ReactNode } from "react";
import enGB from "../locales/en-GB.json" with { type: "json" };
import {
  createI18n,
  type I18nInstance,
  type I18nLocaleInput,
  type CreateI18nOptions,
} from "./index.ts";

export type { I18nInstance, I18nLocaleInput, CreateI18nOptions };

/**
 * Placeholder React provider type contract.
 * Replace with real React context implementation in ADR-ACT-0121.
 */
const defaultI18n = createI18n({ locale: "en-GB", messages: enGB });

const I18nContext = createContext<I18nInstance>(defaultI18n);

export interface I18nProviderProps {
  locale: string;
  messages: I18nLocaleInput;
  fallback?: I18nLocaleInput;
  children: ReactNode;
}

/**
 * Create an i18n instance scoped for a React component tree.
 * This is the bootstrap call ? in the full implementation (ADR-ACT-0121)
 * this will be wrapped in a React Context so child components can call
 * useTranslation() without explicit prop threading.
 */
export function createReactI18n(options: CreateI18nOptions): I18nInstance {
  return createI18n(options);
}

export function I18nProvider({ locale, messages, fallback, children }: I18nProviderProps) {
  const value = useMemo(
    () => createI18n({ locale, messages, fallback }),
    [locale, messages, fallback]
  );
  return createElement(I18nContext.Provider, { value, children });
}

export function useTranslation() {
  const i18n = useContext(I18nContext);
  return i18n.t;
}
