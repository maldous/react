# Semantic Source Of Truth Transition

V1-final is historical evidence and a proof reference after the V2 cut. It is not the live semantic authority for new platform behaviour. V1 may be reopened only for evidence correction.

After the V2 cut, the canonical source of truth is the V2 foundation semantic asset set: capability definitions, state machines, permission contracts, error catalogues, UI semantic contracts, proof definitions, environment semantics, cross-capability interactions, event semantics, operational semantics, and validator rules.

V2 code must not drift from capability definitions or contracts. Any post-V2 behaviour change must update capability definition, contracts, permissions, validation, errors, events, operational semantics, environment semantics, UI semantics, proofs, and validator rules when the semantic class changes in the same change.

Forbidden post-cut drift cases:

- code behaviour changes without semantic artefact updates
- UI behaviour invented from generated components
- event emission without event semantics
- new provider without environment and operational semantics
- new capability without proof level and readiness model

The V2-readiness validator enforces this transition through R28-semantic-source-transition and the semantic artefact rules R22-R29. Validators are enforcement; proofs are evidence; V2 code is only the implementation of canonical V2 semantic artefacts.
