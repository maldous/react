# Package architecture metadata schema

This directory contains JSON Schemas governed by ADRs for the `architecture` metadata object inside package-level `package.json` files.

Source decisions:

```text
docs/adr/0005-define-package-metadata-format.md
docs/adr/0006-define-package-lifecycle-transition-rules.md
```

The schema validates the package-local architecture metadata shape.

It does not replace ADR-0005 or ADR-0006.

Current schema:

```text
package-json-architecture.schema.json
```

Important limits:

```text
JSON Schema validates local shape, enum values, and selected conditional rules.
Cross-package dependency checks need implementation tooling.
Domain/context-map validation needs project data from ADR-0002 follow-up work.
Lifecycle transition validation needs package history or PR metadata.
Generated README freshness needs generator tooling.
```

## Lifecycle transition evidence

```text
docs/schemas/lifecycle-transition-evidence.schema.json
```

Validates governed lifecycle transition evidence bundles under `docs/evidence/lifecycle/`.
