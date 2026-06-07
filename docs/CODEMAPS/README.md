# Architecture Codemaps

**Last Updated:** 2026-06-07

Index of all codemaps. Each map documents a system slice: packages, apps, import boundaries, decisions, or infrastructure.

| Map                            | Purpose                                                                                        |
| ------------------------------ | ---------------------------------------------------------------------------------------------- |
| [packages.md](packages.md)     | All 48 packages: name, lifecycle class, bounded context, @platform dependencies                |
| [apps.md](apps.md)             | Two apps (platform-api BFF, react-enterprise-app SPA): entry points, dependencies, test counts |
| [boundaries.md](boundaries.md) | Import boundary rules: 39 rules enforcing layering, leaf nodes, and contract purity            |
| [adrs.md](adrs.md)             | Architecture Decision Records: 35 ADRs (0001–0035, 0018 absent), all accepted                  |
| [infra.md](infra.md)           | Infrastructure services: Compose profiles, service/port map, Caddy virtual hosts               |

## Quick Links

- **ADR Foundation**: See [docs/adr/README.md](../adr/README.md) and `ACTION-REGISTER.md`
- **Package Metadata**: Each package declares its role, lifecycle, and governance in `package.json::architecture`
- **Lifecycle Policy**: ADR-0004, ADR-0006 define stable/active/experimental classes
- **Hexagonal Architecture**: ADR-0001 — adapters/domain/contracts/runtimes stack
- **Multi-tenant**: ADR-0029, ADR-0030 — FQDN routing + UMA resource policies

## Legend

- **Lifecycle**: stable (production-ready), active (maintained), experimental (emerging)
- **Bounded Context**: owning domain or subsystem (from package.json::architecture.component.boundedContext)
- **@platform/\* deps**: intra-monorepo dependencies only (external packages listed in individual package.json)
