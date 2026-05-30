import { createI18n, enGB, type I18nParams } from "@platform/i18n-runtime";

// Single i18n instance backed by the canonical en-GB locale bundle from
// @platform/i18n-runtime. All server-side translatable strings live there ?
// no duplicate locale data in the API layer. ADR-0026.
const _serverI18n = createI18n({ locale: "en-GB", messages: enGB });

export function serverT(key: string, params?: I18nParams): string {
  return _serverI18n.t(key, params);
}
