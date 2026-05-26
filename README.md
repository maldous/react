# Architecture baseline

This repository contains the current architecture decision baseline and package metadata validation tooling.

## Key locations

```text
docs/adr/
  Architecture decision records and action register.

docs/schemas/
  Architecture-governed JSON Schemas.

tools/architecture/validate-package-metadata/
  Package metadata validation tool.

reports/validation/
  Generated validation reports. Ignored by default.
```

## Validate package architecture metadata

Run the validator from the repository root:

```bash
node tools/architecture/validate-package-metadata/src/index.mjs
```

The validator reads:

```text
docs/schemas/package-json-architecture.schema.json
```

By default it scans package manifests under:

```text
apps/**/package.json
packages/**/package.json
tools/architecture/**/package.json
```

It writes reports to:

```text
reports/validation/package-metadata-validation.json
reports/validation/package-metadata-validation.md
```

## Validate specific paths

Validate packages only:

```bash
node tools/architecture/validate-package-metadata/src/index.mjs packages
```

Validate apps and packages:

```bash
node tools/architecture/validate-package-metadata/src/index.mjs apps packages
```

Validate the architecture tooling package:

```bash
node tools/architecture/validate-package-metadata/src/index.mjs tools/architecture/validate-package-metadata
```

## Expected package metadata

Each package should include an `architecture` object in `package.json`.

The source schema is:

```text
docs/schemas/package-json-architecture.schema.json
```

The package README should be generated from package metadata when README generation tooling exists.

## Exit codes

```text
0  validation passed
1  validation failed
```

## Notes

The validator enforces local package metadata shape and selected cross-field rules.

Cross-package dependency checks, affected-package CI, README generation, and lifecycle transition evidence validation are follow-up tooling concerns.

## Version control expectations

Commit architecture source and governance artifacts:

```text
docs/adr/**
docs/schemas/**
docs/evidence/**
tools/architecture/**
```

Generated reports are ignored by default:

```text
reports/**
```

Run validation locally to regenerate reports when required.

Lifecycle transition evidence is not a generated report. It is committed under:

```text
docs/evidence/lifecycle/
```
