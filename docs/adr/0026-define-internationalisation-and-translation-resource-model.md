# ADR-0026: Define internationalisation and translation resource model

## Status

Accepted

## Date

2026-05-29

## Decision owner

Architecture owner / technical lead.

## Consulted

- Engineering team
- Product owner
- Accessibility reviewer
- Security reviewer

## Context

The platform now has public-facing React routes, safe API errors, authentication flows, validation messages, and future email / notification surfaces.

If text remains embedded directly inside React components, API handlers, validation schemas, and templates, every later language becomes a retrofit. Retrofitting internationalisation usually creates inconsistent wording, duplicated translations, fragile tests, and hidden public text in places reviewers do not expect.

The platform should instead treat public-facing text as a first-class architectural boundary.

The first supported language is English UK (`en-GB`). The initial goal is not to ship multiple languages immediately. The goal is to wire the whole platform so future languages can be added by supplying translation resources, not by rewriting application logic.

## Stakeholder concerns

- Product:
  - Public text should be consistent across screens, errors, emails, and notifications.
  - English UK should be the baseline language and spelling standard.
  - Future languages should not require a new architecture decision for every feature.

- Engineering:
  - Components should not contain hard-coded public copy.
  - API responses should keep stable machine-readable codes.
  - Tests should not become brittle because translated wording changes.
  - Translation keys should be discoverable and validated.

- Accessibility:
  - Accessible names, aria labels, help text, error text, and empty states are public-facing text and must be translated.
  - Translation changes must not break screen-reader context.

- Security:
  - Logs, traces, internal diagnostics, secret names, and developer-only errors are not translation resources.
  - Public error messages must remain safe and must not expose internal details.

## Decision drivers

- Make internationalisation a platform rule before more slices add public text.
- Start with English UK but avoid an English-only architecture.
- Keep public text in version-controlled JSON translation resources.
- Keep API contracts stable through codes and structured data, not translated strings alone.
- Support React, BFF/API, validation, email, notification, and future server-rendered/public surfaces.
- Enable automated checks that detect hard-coded public text.

## Options considered

### Option A: Keep hard-coded English text until another language is required

Pros:

- Fastest short-term delivery.
- No translation tooling required immediately.

Cons:

- Makes future language support a retrofit.
- Hides public copy across components, routes, validation schemas, tests, emails, and API handlers.
- Encourages inconsistent wording and duplicated strings.
- Conflicts with the platform principle that foundations should be created before slices depend on shortcuts.

### Option B: React-only internationalisation

Pros:

- Solves most visible UI text.
- Simple to introduce in the SPA.

Cons:

- Does not cover API error messages, auth redirects, emails, notifications, accessibility text generated outside components, or future public surfaces.
- Allows backend public messages to drift from UI messages.
- Does not wire future language support through the whole platform.

### Option C: Platform-wide translation resource model

Pros:

- One decision covers React, BFF/API, validation, emails, notifications, and future public surfaces.
- Translation keys become stable architectural identifiers.
- Public text is reviewable in JSON resource files.
- Future languages can be added by adding locale resources.
- Tooling can enforce no hard-coded public text.

Cons:

- Requires an i18n runtime and validation work before the next user-facing slice grows.
- Requires discipline around naming keys and avoiding string concatenation.
- Some tests must assert keys/codes or accessible behaviour rather than exact English text.

## Decision

Use a platform-wide internationalisation model with English UK (`en-GB`) as the first and default locale.

All public-facing text must be referenced through translation keys and resolved through locale JSON resources.

The initial translation resource format is JSON.

The baseline resource file is:

```text
packages/i18n-runtime/locales/en-GB.json
```

Future locale files follow the same shape:

```text
packages/i18n-runtime/locales/<bcp-47-locale>.json
```

Examples:

```text
packages/i18n-runtime/locales/fr-FR.json
packages/i18n-runtime/locales/id-ID.json
packages/i18n-runtime/locales/zh-Hans.json
```

Locale identifiers must use BCP 47 language tags. The platform default is `en-GB`.

## Scope

Internationalised public-facing text includes:

- React visible copy
- page titles and route labels
- form labels, placeholders, hints, validation messages, and helper text
- empty, loading, success, warning, and error states
- accessible names, aria labels, aria descriptions, and alt text
- BFF/API user-safe error messages
- authentication flow messages that may be shown to a user
- email subjects and bodies
- notification titles and bodies
- public export/report labels if exposed to users
- public documentation generated from application copy, where applicable

Internationalisation does not apply to:

- log messages
- trace/span names
- metric names
- internal error details
- exception class names
- environment variable names
- database column names
- migration names
- package names
- developer-only diagnostics
- test descriptions
- stable machine-readable API error codes

## Translation key model

Translation keys must be stable, namespaced, and descriptive.

Use dot-separated keys:

```text
app.shell.nav.organisationProfile
feature.organisation.profile.title
feature.organisation.profile.form.displayName.label
feature.organisation.profile.form.displayName.validation.required
auth.login.error.unverifiedEmail
api.error.unauthenticated
email.invitation.subject
notification.profileUpdated.title
```

Rules:

- Keys describe meaning, not current English wording.
- Keys must not contain user data.
- Keys must not be reused for unrelated contexts even when English text is identical.
- Public text must not be assembled through unsafe string concatenation.
- Dynamic values must use interpolation parameters.
- Plurals, counts, dates, numbers, and currencies must be formatted through the i18n runtime, not manually.

## JSON resource shape

The translation JSON must be nested by namespace.

Example:

```json
{
  "app": {
    "shell": {
      "nav": {
        "organisationProfile": "Organisation profile"
      }
    }
  },
  "feature": {
    "organisation": {
      "profile": {
        "title": "Organisation profile",
        "form": {
          "displayName": {
            "label": "Display name",
            "validation": {
              "required": "Display name is required",
              "tooShort": "Display name must be at least {min} characters",
              "tooLong": "Display name must be {max} characters or fewer"
            }
          }
        }
      }
    }
  },
  "api": {
    "error": {
      "unauthenticated": "You need to sign in to continue",
      "forbidden": "You do not have permission to perform this action"
    }
  }
}
```

## Runtime model

The platform will provide a small i18n runtime package.

Required capabilities:

- load `en-GB` as the default locale
- resolve translation keys by locale
- fall back to `en-GB` when a key is missing from a non-default locale
- fail validation when `en-GB` is missing a key used by code
- interpolate named parameters safely
- format dates, numbers, and currencies using `Intl`
- expose a React provider/hook for UI code
- expose a server helper for BFF/API, email, and notification code

The runtime may later wrap a library such as FormatJS, i18next, Lingui, or another maintained message-format library. This ADR does not require committing to that vendor yet. The platform-owned boundary is the translation resource model and runtime contract.

## Locale resolution

Locale resolution order:

1. Explicit user preference, once profile preferences exist.
2. Session actor locale, once carried by the session model.
3. `Accept-Language` header for unauthenticated/public requests.
4. Platform default: `en-GB`.

The React app must receive the active locale through application bootstrap/session state, not by each component independently parsing browser settings.

The BFF/API must resolve locale once per request and attach it to runtime context where user-facing messages may be produced.

## API and contract rules

Public API responses must keep stable machine-readable codes.

Translated text may be included as a display message, but clients must not depend on the English text for control flow.

Preferred error shape:

```json
{
  "code": "UNAUTHENTICATED",
  "message": "You need to sign in to continue"
}
```

The `code` is stable. The `message` is localised.

Validation schemas should prefer structured error codes or translation keys. Hard-coded public validation text inside schema definitions should be avoided unless the schema is explicitly scoped to internal/developer-only use.

## React rules

React components, routes, hooks, and feature clients must not hard-code public copy.

They must use translation keys through the i18n React boundary.

Allowed hard-coded strings in React:

- route paths
- test IDs
- CSS class names
- internal enum values
- internal error codes
- non-user-facing developer assertions

Not allowed:

- button text
- headings
- labels
- placeholders
- help text
- aria labels
- alt text
- empty state text
- loading or success messages
- user-visible error text

## Server rules

BFF/API code must not leak internal error details through translated messages.

Server-side translation is required for:

- user-safe API errors
- authentication user-facing failures
- email and notification templates
- public export labels

Server-side translation is not required for logs, traces, metrics, or diagnostics.

## Testing rules

Tests should avoid depending on full English wording unless the test is specifically validating translation output.

Preferred assertions:

- translation key exists
- accessible role/name resolves correctly
- API error code is stable
- locale fallback works
- interpolation parameters render safely
- missing `en-GB` keys fail validation

E2E tests may assert English UK text for critical user flows when that text is part of the user contract, but they should favour roles and accessible names over brittle full-page copy matching.

## Tooling and enforcement

The platform will add an i18n validation gate before the next public-facing slice expands.

The gate must check:

- every key used in source exists in `en-GB.json`
- non-default locale files match the `en-GB` key structure when added
- no duplicate semantic keys exist in a single namespace
- interpolation variables in translations match variables used in code
- public-facing source files do not introduce obvious hard-coded copy outside allowed exceptions

The initial enforcement may be report-only for discovery, then promoted to a hard gate once the first migration pass is complete.

## Consequences

- ADR-ACT-0120: Create i18n runtime package and `en-GB` JSON resource baseline.
- ADR-ACT-0121: Migrate current React public text to translation keys.
- ADR-ACT-0122: Migrate safe API/auth/validation public messages to translation keys while preserving stable error codes.
- ADR-ACT-0123: Add i18n validation tooling and wire it into architecture checks.
- ADR-ACT-0124: Add tests/evidence for locale fallback, interpolation, and no-token/no-secret leakage through translated messages.
- Future product slices must not add public-facing hard-coded text.
- Future languages are introduced by adding locale JSON files that match the `en-GB` key structure.

## References

- ADR-0011: Architecture tooling execution model
- ADR-0019: React component platform and frontend integration stack
- ADR-0020: Observability, diagnostics, and runtime introspection primitives
- ADR-0021: Identity, tenancy, roles, and permissions model
- ADR-0022: Authentication session and SSO integration boundary
- ADR-0025: Playwright end-to-end testing strategy
- Unicode BCP 47 language tags
- ECMAScript `Intl` APIs
