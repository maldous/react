# License policy

## Purpose

This document defines the license policy for all direct and transitive dependencies of the `maldous/react` platform. It governs which open-source licenses are acceptable without review, which require review, and which are blocked pending explicit approval.

## Policy

### Allowed (no review required)

These licenses are permissive and compatible with proprietary and commercial use:

- MIT
- Apache-2.0
- BSD-2-Clause
- BSD-3-Clause
- ISC
- CC0-1.0
- Unlicense
- 0BSD

### Requires review before use

These licenses have reciprocal or network clauses that may affect the platform depending on how the dependency is used:

- MPL-2.0 (Mozilla Public License 2.0) — file-level copyleft; compatible if files are kept separate
- EPL-1.0 / EPL-2.0 (Eclipse Public License) — weak copyleft; review required
- LGPL-2.0 / LGPL-2.1 / LGPL-3.0 (Lesser GPL) — compatible if dynamically linked; static linking requires review

Review is requested via an ADR-ACT entry citing the dependency name, version, and intended use.

### Blocked without explicit written approval

These licenses impose strong copyleft requirements incompatible with the platform's commercial use model, or are not approved for use in this codebase:

- GPL-2.0 / GPL-3.0 (GNU General Public License)
- AGPL-3.0 (GNU Affero General Public License) — network-use copyleft applies to web services
- SSPL (Server Side Public License)
- Commons Clause modifier
- Unknown / unlicensed
- Custom commercial licenses

If a dependency is detected with a blocked license, the dependency must be replaced or an explicit written approval obtained from the architecture owner and legal representative before merge.

## Enforcement

License scanning is a report-only advisory gate until a stable tool is integrated (see ADR-ACT-0086). Until then:

- New dependencies should be checked manually against this policy before adding.
- The `npm audit` and OSV scanner gates catch security issues but do not enforce license policy.
- A `license:check` script will be added when a stable CLI tool is available.

## Evidence

License compliance evidence is committed under `docs/evidence/security/`.

## Review cadence

This policy is reviewed annually or when the dependency set changes materially (e.g. new framework, new adapter, new testing infrastructure).

## References

- SPDX License List: <https://spdx.org/licenses/>
- ADR-0016: Enterprise quality gate baseline
