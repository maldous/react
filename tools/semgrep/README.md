# Semgrep rules (repo constraints)

Repo-specific static rules encoding the hard constraints from `CLAUDE.md` and ADR-0001/0013/0029/0030/0037/0043.

## Run

```bash
npm run semgrep        # report ALL findings (advisory)
npm run semgrep:json   # machine-readable output
npm run semgrep:gate   # ERROR-severity only, exit non-zero on any — used by `make check`
```

Or directly:

```bash
semgrep scan --config tools/semgrep/rules.yml --metrics=off
```

## Rules

| Rule                                             | Severity | Maps to                            |
| ------------------------------------------------ | -------- | ---------------------------------- |
| `no-adapter-import-in-spa`                       | ERROR    | Constraint #1/#3/#7, ADR-0001/0013 |
| `no-server-runtime-import-in-spa`                | ERROR    | Constraint #2/#7                   |
| `no-bff-bypass-absolute-url-fetch-in-spa`        | WARNING  | Constraint #1, ADR-0013            |
| `no-adapter-import-in-pure-layers`               | ERROR    | Constraint #3, ADR-0001            |
| `no-pino-in-pure-layers`                         | ERROR    | Constraint #4                      |
| `no-otel-sdk-in-platform-observability`          | ERROR    | Constraint #5, ADR-0020            |
| `no-console-in-bff-and-adapters`                 | WARNING  | Constraint #7                      |
| `no-raw-error-in-routes-and-usecases`            | INFO     | Constraint #6                      |
| `no-raw-keycloak-representation-outside-adapter` | WARNING  | ADR-0037/0043                      |
| `no-secret-in-log-or-audit`                      | ERROR    | Constraint #8, ADR-0043            |

## Status & security

- **Review aid, not a hard gate.** Not wired into `make check`; does not replace or weaken
  `validate-source-imports`, the orchestrator, or `secrets:scan` — it complements them.
- **Offline only.** Always run with `--metrics=off`. Never `semgrep login` / `--upload` from this repo.
- Promotion to a gate requires an ADR amendment (the import-boundary gate is the authoritative one).
