# Generated Outputs Policy (ADR-ACT-0038)

Defines which outputs are generated from `package.json` architecture metadata and how.

## Current generated outputs

| Output                                              | Generator                    | Trigger                               | Source metadata                                           |
| --------------------------------------------------- | ---------------------------- | ------------------------------------- | --------------------------------------------------------- |
| `packages/<name>/README.md` (description block)     | `generate-package-readmes`   | `npm run readmes` / architecture gate | `package.json` description, role, lifecycle, dependencies |
| `docs/evidence/architecture/package-inventory.json` | `generate-package-inventory` | architecture gate                     | All packages' metadata                                    |
| `docs/evidence/architecture/lifecycle-report.json`  | `generate-lifecycle-reports` | architecture gate                     | Lifecycle stage per package                               |

## Planned outputs (deferred until tooling is adopted)

- **Backstage catalog entries** (`catalog-info.yaml`) — when Backstage is adopted
- **C4 component inventory** — when C4 tooling is integrated
- **Runtime deployment metadata** — when deployment config is formalised

## Metadata schema

Each `package.json` must include an `x-architecture` block with:

```json
{
  "x-architecture": {
    "component": { "type": "...", "name": "..." },
    "lifecycle": { "stage": "experimental|evolving|stable|deprecated" },
    "boundaries": { ... },
    "readme": { "generated": true, "summary": "...", "responsibilities": [...] }
  }
}
```

The `validate-package-metadata` tool enforces this schema at the architecture gate.
Any new package must include this metadata before the PR can merge.

## Extending outputs

To add a new generated output:

1. Add an ADR amendment or new ADR explaining what is generated and why.
2. Add a tool under `tools/architecture/<tool-name>/`.
3. Wire the tool into the orchestrator (`tools/architecture/orchestrator/src/index.mjs`).
4. Add the output path to `docs/adr/ACTION-REGISTER.md`.
5. Update this document.
