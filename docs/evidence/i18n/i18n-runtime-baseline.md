# Evidence: ADR-ACT-0120 — i18n runtime baseline

**Date:** 2026-05-29
**Status:** Done
**Action:** ADR-ACT-0120
**ADR Ref:** ADR-0026

## Summary

`packages/i18n-runtime` created with:

- `locales/en-GB.json`: baseline en-GB nested JSON resource file
- `src/index.ts`: `createI18n()` (accepts nested or flat input), `serverT()`,
  `flattenLocaleMessages()`, `I18nLocaleResource` (nested), `I18nMessages` (flat),
  `I18nLocaleInput` (union), `I18nLocale` (@deprecated alias)
- `src/react.ts`: React boundary entry point — exports `createReactI18n()` bootstrap
  (placeholder; full `I18nProvider`/`useTranslation` hook deferred to ADR-ACT-0121)
- 14 unit tests: flattening, flat backward-compat, nested JSON resolution,
  interpolation, XSS escape, fallback (flat+nested), serverT

## en-GB keys provisioned

- `app.shell.nav.organisationProfile`
- `feature.organisation.profile.title`
- `feature.organisation.profile.form.displayName.label`
- `feature.organisation.profile.form.displayName.validation.required`
- `feature.organisation.profile.form.displayName.validation.tooShort`
- `feature.organisation.profile.form.displayName.validation.tooLong`
- `api.error.unauthenticated`
- `api.error.forbidden`
- `api.error.emailUnverified`
- `api.error.authStateMismatch`

## Deferred

- Full `I18nProvider`/`useTranslation` React hook — `src/react.ts` is a
  bootstrap placeholder only; real React Context implementation tracked in ADR-ACT-0121
- Date/number/currency formatting via `Intl`
- Full React text migration: ADR-ACT-0121 (Open)
- API message migration: ADR-ACT-0122 (Open)
- Validation gate promotion to hard gate: ADR-ACT-0123 (In Progress)
