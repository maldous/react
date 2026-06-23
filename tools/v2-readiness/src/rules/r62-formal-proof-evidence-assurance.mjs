import { finding } from "../vocab.mjs";
import { buildAdversarialUSFAudit } from "../adversarial-usf-audit.mjs";
import {
  PROOF_EVIDENCE_REQUIRED_FIELDS,
  buildProofEvidenceAssurance,
  proofLevelNumber,
} from "../proof-evidence.mjs";

export default function r62FormalProofEvidenceAssurance(ctx) {
  if (!ctx.repoRoot) return [];
  const out = [];
  const audit = buildAdversarialUSFAudit(ctx);
  const assurance = buildProofEvidenceAssurance(ctx, audit);

  for (const record of assurance.evidenceIndex.records) {
    for (const field of PROOF_EVIDENCE_REQUIRED_FIELDS) {
      if (!(field in record)) {
        out.push(
          finding(
            "R62-formal-proof-evidence-assurance",
            record.subjectId,
            `proof evidence missing "${field}"`
          )
        );
      }
    }
    if (proofLevelNumber(record.proofLevelClaimed) > proofLevelNumber(record.proofLevelObserved)) {
      out.push(
        finding(
          "R62-formal-proof-evidence-assurance",
          record.subjectId,
          `claimed ${record.proofLevelClaimed} exceeds observed ${record.proofLevelObserved}`
        )
      );
    }
    if (record.subjectType.includes("provider") && !record.providerMode) {
      out.push(
        finding(
          "R62-formal-proof-evidence-assurance",
          record.subjectId,
          "provider proof has no environment-specific proof mode"
        )
      );
    }
    if (
      /\b(observability|metrics?|traces?|logs?|spans?)\b/i.test(record.subjectId) &&
      !(record.traceObserved && record.metricObserved && record.logObserved)
    ) {
      out.push(
        finding(
          "R62-formal-proof-evidence-assurance",
          record.subjectId,
          "observability proof lacks captured trace/log/metric evidence"
        )
      );
    }
  }

  for (const provider of assurance.inMemoryParity.gaps) {
    out.push(
      finding(
        "R62-formal-proof-evidence-assurance",
        provider.provider,
        "in-memory provider lacks parity mapping or semantic/failure/observability evidence"
      )
    );
  }

  for (const route of assurance.routeSubjectMap.gaps) {
    out.push(
      finding(
        "R62-formal-proof-evidence-assurance",
        `${route.method} ${route.path}`,
        "route proof subject mapping is missing, broad, or fuzzy"
      )
    );
  }

  for (const row of ctx.foundation?.["environment-capability-matrix.json"]?.capabilities || []) {
    if (row.dev?.providerClass === "in-memory" && row.dev?.composeRequired === true) {
      out.push(
        finding(
          "R62-formal-proof-evidence-assurance",
          row.capability || row.id || "<capability>",
          "semantic-dev in-memory provider still requires Compose"
        )
      );
    }
  }

  return out;
}
