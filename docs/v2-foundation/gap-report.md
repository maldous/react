# V1→V2 Zero-Gap Reconciliation — Gap Report (Pass Two)

**Verdict: ZERO UNRESOLVED GAPS.** Every proposed V2 dir/file/package/contract/port/adapter/
service/config/command/test/capability/decision/UI-def is justified by an exact V1 source, proof,
or final decision. All invariants reconcile.

This is the independent reverse pass: it starts from the proposed V2 and walks back to V1.

## Invariant verification

| Invariant                | Required                            | Found                                                                                                                                   | Status |
| ------------------------ | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Tracked V1 files         | 1673                                | 1673 (inventory) = 1673 (path-map), bijective                                                                                           | PASS   |
| Disposition sum          | = 1673                              | reuse 1239 + git-move 19 + split 1 + merge 1 + regenerate 186 + archive 179 + delete-after-proof 48 = 1673                              | PASS   |
| Every V1 file mapped     | yes                                 | 0 orphans, 0 missing disposition, 0 missing v2Path on active dispositions                                                               | PASS   |
| Multiply-mapped          | none w/o explanation                | none                                                                                                                                    | PASS   |
| Make targets             | V2 targets + retired                | 121 make commands, all carry/merge/retire; bijective with v2-command-map                                                                | PASS   |
| npm scripts              | V2 scripts + retired                | 130 npm commands, all carry/merge/retire; bijective                                                                                     | PASS   |
| All commands             | carry+merge+retire                  | 299 = carry 256 + merge 42 + retire 1; bijective both directions                                                                        | PASS   |
| Tests/proofs             | carried+retargeted+promoted+retired | 307 = carry 168 + promote-to-conformance 76 + retarget 61 + retire 2; retired have justification; active have v2Path                    | PASS   |
| ADRs/actions/history     | V2 decisions + historical           | 74 V2 decisions, all Accepted; every one has lineage with a V1 ADR/action/evidence/commit source; history preserved as archive-evidence | PASS   |
| Capabilities             | delivered+rejected+N/A+superseded   | 75 = delivered-and-proven 71 + not-applicable-final 4; 0 pending/ambiguous; all delivered have v2Target; N/A justified                  | PASS   |
| Every V2 justified by V1 | yes                                 | confirmed across all artefacts                                                                                                          | PASS   |

## Unresolved gaps

**None.** No item is unmapped, multiply-mapped without explanation, orphaned, unsupported,
contradictory, pending, or ambiguous.

## Soft mappings (examined and cleared — NOT gaps)

These literal-rule near-misses were inspected and confirmed correct:

1. **46 `delete-after-proof` entries without `protectingTests`** — 41 are `.gitkeep` directory
   placeholders (no behaviour); 5 are deprecated-package metadata/README/index for `domain-core`
   and `worker-runtime`. Their deletion is gated by `deletionCondition` citing ADR-0006 /
   ADR-ACT-0288, not by a protecting test. No runtime behaviour to protect. Cleared.
2. **149 non-`reuse` entries without `decisionRefs`** — 41 `.gitkeep`, 12 build manifests
   (`package.json`, `package-lock.json`, `tsconfig.json`, `loader.mjs`), 96 evidence/spec/image/
   superpowers documents dispositioned `archive-evidence` or `regenerate`. These ARE the historical
   record or regenerated artefacts; they are not decisions and require no ADR reference. Cleared.
3. **2 `refactor-behind-contract` docs without `retainedInterfaces`** —
   `docs/local-development/compose-services.md` and `docs/patterns/ui-feature-template.md` are
   documentation refactors with no programmatic interface; governed by v2-directory-contracts. Cleared.

## Ranked V1 completion programme

Because reconciliation is gap-free, the only remaining work before V1 may be declared complete is
**executing** the dispositions that carry a proof/stop condition (chiefly `delete-after-proof`). No
discovery, no design. See `v1-completion-programme.md` for the standalone copy. The full P0–P3
programme with per-action detail is reproduced there.
