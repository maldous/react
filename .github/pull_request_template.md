# Pull request checklist

Before requesting review, verify all items below.

## Quality gates

- [ ] `npm run format:check` passes (Prettier)
- [ ] `npm run lint:md` passes (markdownlint)
- [ ] `npm run lint` passes (ESLint)
- [ ] `npm run audit:deps` passes (npm audit --audit-level=high)
- [ ] `npm run audit:osv` passes (OSV vulnerability scan)
- [ ] No secrets detected (gitleaks runs automatically in CI)

## Architecture gates

- [ ] `node tools/architecture/orchestrator/src/index.mjs all --no-reports --strict` passes
- [ ] All architecture tooling tests pass (`node --test tools/architecture/...`)

## Governance

- [ ] Evidence updated if governance tooling configuration changed (`docs/evidence/quality-gates/`)
- [ ] ADR updated or created if a material architectural decision was made
- [ ] ACTION-REGISTER updated if an action was opened, progressed, or closed

## Description

<!-- What does this PR do? Why? -->

## Testing

<!-- How was this tested? -->
