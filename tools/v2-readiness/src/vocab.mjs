// Canonical vocabularies — the ONLY allowed values. No aliases, no normalisation.
export const FILE_DISPOSITIONS = [
  "reuse-unchanged",
  "git-move",
  "split",
  "merge",
  "regenerate",
  "archive-evidence",
  "delete-after-proof",
  "refactor-behind-contract",
  "replace-retain-contract",
];
export const COMMAND_DISPOSITIONS = ["carry", "merge", "retire"];
export const TEST_MIGRATION_TYPES = ["carry", "retarget", "promote-to-conformance", "retire"];
export const CAPABILITY_STATUSES = [
  "delivered-and-proven",
  "not-applicable-final",
  "rejected-final",
  "superseded-by-proven-canonical",
  "requires-v1-completion",
];

// The 10 zero-consumer deprecated packages removed before the cut (ADR-ACT-0289).
export const DEPRECATED_REMOVE_PACKAGES = [
  "domain-core",
  "access-control",
  "feature-workflow",
  "profile-configuration",
  "security-auth",
  "queue-runtime",
  "search-runtime",
  "notification-runtime",
  "worker-runtime",
  "observability",
];

// Tree markers that must NOT survive in v2-target-tree.txt (kept-as-canonical homes).
export const FORBIDDEN_TREE_MARKERS = [
  "[~] was domain-core",
  "[~] notification-runtime",
  "[~] profile-configuration",
  "[~] queue-runtime",
  "[~] search-runtime",
  "[~] worker-runtime",
  "[~] access-control (permission model)",
  "[~] security-auth",
  "[~] observability (signal taxonomy)",
];

// Hard placeholder tokens forbidden in closure-claim artefacts. {{PINNED_V1_COMMIT}} is allowed.
export const HARD_PLACEHOLDERS = [
  "<undefined>",
  "TBD",
  "TODO",
  "must decide",
  "candidate",
  "not integrated",
];

export const AUDITED_V1_COMMIT = "918cd148569f6473eeaa58284933abdc0fe5bafe";
export const UNRESOLVED_PIN = ["<undefined>", "{{PINNED_V1_COMMIT}}", "TBD", "TODO", ""];

export const finding = (ruleId, subject, message, severity = "error") => ({
  ruleId,
  severity,
  subject,
  message,
});
