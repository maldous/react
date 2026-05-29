# Evidence: ADR-ACT-0120 — i18n runtime baseline

**Date:** 2026-05-29
**Status:** Done
**Action:** ADR-ACT-0120
**ADR Ref:** ADR-0026

## Summary

`packages/i18n-runtime` created with:

- `locales/en-GB.json`: baseline en-GB resource file
- `src/index.ts`: `createI18n()`, `serverT()`, `I18nLocale` type, `I18nParams` type, `I18nInstance` interface
- 8 unit tests: key resolution, interpolation, XSS escape, fallback, missing key

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

- React provider/hook (separate src/react.ts entry to avoid pulling React into BFF)
- Date/number/currency formatting via Intl
- Full React text migration: ADR-ACT-0121 (Open)
- API message migration: ADR-ACT-0122 (Open)
- Validation gate: ADR-ACT-0123 (Open)
