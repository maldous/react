/**
 * @platform/i18n-runtime/react – React provider/hook boundary (ADR-0026)
 *
 * Separate entry point so server-side code (BFF/API) can import from
 * @platform/i18n-runtime without pulling in React as a dependency.
 *
 * Usage:
 *   import { I18nProvider, useTranslation, useMessage, LocalizedText }
 *     from "@platform/i18n-runtime/react";
 *
 * This module satisfies the ADR-0026 "Runtime model" requirement:
 *   "expose a React provider/hook for UI code"
 *
 * ADR-ACT-0121 — full implementation: typed context, provider ownership of
 * locale + catalogue, hooks that fail clearly outside the provider, single-key
 * resolution, and an inline LocalizedText component.
 */

import { createContext, createElement, useContext, useMemo, type ReactNode, type FC } from "react";
import _enGB from "../locales/en-GB.json" with { type: "json" };
import {
  createI18n,
  type I18nInstance,
  type I18nLocaleInput,
  type CreateI18nOptions,
  type I18nParams,
  type MessageKey,
} from "./index.ts";

export type { I18nInstance, I18nLocaleInput, CreateI18nOptions, I18nParams, MessageKey };

// ── Context (null = no provider) ────────────────────────────────────────────

/**
 * I18nContext defaults to null so hooks can detect missing-provider usage and
 * fail clearly in production rather than silently returning keys as-is.
 */
const I18nContext = createContext<I18nInstance | null>(null);

// ── Provider ────────────────────────────────────────────────────────────────

export interface I18nProviderProps {
  /** BCP 47 locale tag, e.g. "en-GB", "fr-FR". */
  locale: string;
  /** Primary locale messages (nested JSON or flat map). */
  messages: I18nLocaleInput;
  /** Fallback locale messages (used when primary is missing a key). */
  fallback?: I18nLocaleInput;
  children: ReactNode;
}

/**
 * Owns the active locale and message catalogue for a React subtree.
 * Every useTranslation() / useMessage() call within the tree resolves
 * through this provider.
 *
 * Locale fallback is explicit and deterministic:
 *   primary locale → fallback locale → raw key (missing)
 */
export function I18nProvider({
  locale,
  messages,
  fallback,
  children,
}: Readonly<I18nProviderProps>) {
  const value = useMemo(
    () => createI18n({ locale, messages, fallback }),
    [locale, messages, fallback]
  );
  return createElement(I18nContext.Provider, { value }, children);
}

// ── Hooks ───────────────────────────────────────────────────────────────────

/**
 * Hook to access the i18n instance from any descendent of I18nProvider.
 *
 * **Fails clearly in production** when called outside an I18nProvider.
 * In development and test environments, falls back to a default en-GB
 * instance so component tests remain backward-compatible without requiring
 * every test to wrap in I18nProvider. The production throw guarantees
 * every translated string has a configured locale source.
 */
export function useI18n(): I18nInstance {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    if (typeof process !== "undefined" && process.env?.NODE_ENV === "production") {
      throw new Error(
        "useI18n() was called outside an <I18nProvider>. " +
          'Wrap your app with <I18nProvider locale="…" messages={…}>.'
      );
    }
    // Non-production: fall back to a default en-GB instance.
    return _getDefaultInstance();
  }
  return ctx;
}

/** Lazily-initialised default instance for non-production environments. */
let _defaultInstance: I18nInstance | undefined;
function _getDefaultInstance(): I18nInstance {
  if (!_defaultInstance) {
    _defaultInstance = createI18n({ locale: "en-GB", messages: _enGB });
  }
  return _defaultInstance;
}

/**
 * Convenience hook: returns the `t()` resolver directly.
 * Equivalent to `useI18n().t`.
 */
export function useTranslation(): I18nInstance["t"] {
  return useI18n().t;
}

/**
 * Resolve a single message key inline.
 *
 *   const message = useMessage("api.error.forbidden");
 *
 * The message is **not reactive to locale or catalogue changes** within the
 * same render — callers that need live updates should re-render when the
 * provider's locale/messages props change (which triggers a new useMemo).
 */
export function useMessage(key: MessageKey, params?: I18nParams): string {
  const i18n = useI18n();
  return i18n.t(key, params);
}

// ── Components ──────────────────────────────────────────────────────────────

export interface LocalizedTextProps {
  /** Canonical message key from the en-GB.json catalogue. */
  k: MessageKey;
  /** Interpolation / ICU parameters for the message template. */
  params?: I18nParams;
  /** Rendered HTML element (default: span). */
  as?: string;
  /** Optional className forwarded to the element. */
  className?: string;
}

/**
 * Renders a single localized message key as an inline element.
 *
 *   <LocalizedText k="auth.login.signInButton" />
 *   <LocalizedText k="feature.organisation.profile.form.displayName.validation.tooShort"
 *                  params={{ min: 2 }} />
 *
 * Falls back to <span>; use the `as` prop to change the element type.
 * Calls useI18n() internally — must be inside an <I18nProvider>.
 */
export const LocalizedText: FC<LocalizedTextProps> = ({ k, params, as = "span", className }) => {
  const message = useMessage(k, params);
  const props: Record<string, unknown> = {};
  if (className) props.className = className;
  return createElement(as, props, message);
};

// ── Non-React helpers ──────────────────────────────────────────────────────

/**
 * Create an i18n instance without React context.
 * Useful for non-React environments (workers, tests, server-side).
 */
export function createReactI18n(options: CreateI18nOptions): I18nInstance {
  return createI18n(options);
}
