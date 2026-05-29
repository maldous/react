# Dependency update policy

Managed by Renovate (`renovate.json`).

## Schedule

Weekly, before 6am Monday (Australia/Sydney timezone).

## Grouping

| Group            | Packages                                                | Auto-merge               |
| ---------------- | ------------------------------------------------------- | ------------------------ |
| Dev tooling      | eslint, prettier, typescript, vitest, markdownlint-cli2 | No (review required)     |
| GitHub Actions   | All actions                                             | No                       |
| Docker images    | Dockerfiles, compose.yaml                               | No                       |
| Playwright       | playwright, @playwright/test                            | No — E2E regression risk |
| Platform runtime | react, zod, @tanstack/\*                                | No — manual review       |
| Major updates    | Any major bump                                          | No — always separate PR  |

## Security alerts

Security PRs are labelled `security` and are never auto-merged.
They must be reviewed manually even for patch updates.

## Manual review required for

- All major version bumps (separate PRs per package, labelled `major-update`)
- React, zod, TanStack libraries
- Playwright (may require E2E test updates)
- Docker base images (Dockerfile rebuild required)

## Adding exclusions

If a package should not be updated automatically, add it to `ignoreDeps` in `renovate.json` with a comment explaining why.
