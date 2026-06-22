import type {
  ClassifyColumnInput,
  CreateDatasetEntryInput,
  CreateDsrInput,
  DataGovernancePort,
  DatasetClassification,
  DsrFulfillmentEvidence,
  DsrType,
} from "../ports/data-governance.ts";
import { AuditAction, createAuditEvent, type AuditEventPort } from "@platform/audit-events";

export interface ClassificationDecision {
  classification: DatasetClassification;
  rule: string;
}

export interface DataGovernanceActor {
  actorId: string;
  actorRoles: string[];
  sourceHost?: string;
}

export interface DataGovernanceDeps {
  port: DataGovernancePort;
  audit: AuditEventPort;
}

const onlyDigits = (value: string) => value.replace(/\D/g, "");

const trimEmailPunctuation = (value: string): string => {
  let start = 0;
  let end = value.length;
  while (start < end && "<([{".includes(value[start] ?? "")) start += 1;
  while (end > start && ">)]},.;:!?".includes(value[end - 1] ?? "")) end -= 1;
  return value.slice(start, end);
};

const hasEmailLikeToken = (value: string): boolean => {
  if (!value.includes("@")) return false;
  for (const rawToken of value.split(/\s+/)) {
    const token = trimEmailPunctuation(rawToken);
    const at = token.indexOf("@");
    if (at <= 0 || at !== token.lastIndexOf("@")) continue;
    const domain = token.slice(at + 1);
    const lastDot = domain.lastIndexOf(".");
    if (lastDot > 0 && domain.length - lastDot > 2) return true;
  }
  return false;
};

const passesLuhn = (digits: string): boolean => {
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let doubleDigit = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let n = Number(digits[i]);
    if (doubleDigit) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    doubleDigit = !doubleDigit;
  }
  return sum % 10 === 0;
};

export const classifyByRulesDetailed = (
  sample: string,
  columnName = ""
): ClassificationDecision => {
  const haystack = `${columnName} ${sample}`;
  if (/\b\d{3}-\d{2}-\d{4}\b/.test(haystack) || /\bssn\b|social.security/i.test(haystack)) {
    return { classification: "sensitive", rule: "sensitive.ssn" };
  }
  if (/\b(?:password|secret|token|api[_ -]?key|credential)\b/i.test(haystack)) {
    return { classification: "sensitive", rule: "sensitive.secret" };
  }
  const digitRuns = haystack.match(/(?:\d[ -]?){13,19}/g) ?? [];
  if (digitRuns.some((run) => passesLuhn(onlyDigits(run)))) {
    return { classification: "sensitive", rule: "sensitive.payment_card_luhn" };
  }
  if (hasEmailLikeToken(haystack)) {
    return { classification: "pii", rule: "pii.email" };
  }
  if (/\b(?:phone|mobile|address|dob|date_of_birth|full[_ -]?name)\b/i.test(haystack)) {
    return { classification: "pii", rule: "pii.column_heuristic" };
  }
  if (/\+?\d[\d ().-]{7,}\d/.test(haystack)) {
    return { classification: "pii", rule: "pii.phone" };
  }
  return { classification: "none", rule: "none.no_match" };
};

export const classifyByRules = (sample: string): DatasetClassification =>
  classifyByRulesDetailed(sample).classification;

const normalizeLineageEdges = (edges: string[] | undefined): string[] => {
  const uniqueEdges = new Set((edges ?? []).map((edge) => edge.trim()).filter(Boolean));
  return [...uniqueEdges].sort((a, b) => a.localeCompare(b));
};

export const createDataset = async (
  input: CreateDatasetEntryInput & { actor: DataGovernanceActor },
  deps: DataGovernanceDeps
) => {
  const owner = input.owner.trim();
  const lineageEdges = normalizeLineageEdges(input.lineageEdges);
  await deps.audit.emit(
    createAuditEvent({
      actorId: input.actor.actorId,
      actorRoles: input.actor.actorRoles,
      tenantId: input.actor.actorId,
      action: AuditAction.DataGovernanceDatasetCreated,
      resource: "data_governance_dataset",
      resourceId: owner,
      metadata: { owner, classification: input.classification, lineageEdges },
      sourceHost: input.actor.sourceHost,
    })
  );
  return deps.port.createDataset({
    ...input,
    owner,
    lineageEdges,
  });
};

export const classifyColumn = async (
  input: ClassifyColumnInput & { actor: DataGovernanceActor },
  deps: DataGovernanceDeps
) => {
  const decision = classifyByRulesDetailed(input.sampleValue, input.columnName);
  await deps.audit.emit(
    createAuditEvent({
      actorId: input.actor.actorId,
      actorRoles: input.actor.actorRoles,
      tenantId: input.actor.actorId,
      action: AuditAction.DataGovernanceColumnClassified,
      resource: "data_governance_classification",
      resourceId: `${input.datasetId}:${input.columnName}`,
      metadata: {
        datasetId: input.datasetId,
        columnName: input.columnName,
        classification: decision.classification,
        rule: decision.rule,
      },
      sourceHost: input.actor.sourceHost,
    })
  );
  return deps.port.classifyColumn({ ...input, ...decision });
};

export const createDsr = async (
  input: CreateDsrInput & { actor: DataGovernanceActor },
  deps: DataGovernanceDeps
) => {
  await deps.audit.emit(
    createAuditEvent({
      actorId: input.actor.actorId,
      actorRoles: input.actor.actorRoles,
      tenantId: input.organisationId,
      action: AuditAction.DataGovernanceDsrCreated,
      resource: "data_governance_dsr",
      resourceId: input.subjectId,
      metadata: { subjectId: input.subjectId, type: input.type, reason: input.reason },
      sourceHost: input.actor.sourceHost,
    })
  );
  return deps.port.createDsr(input);
};

const actionForDsrType = (type: DsrType): DsrFulfillmentEvidence["action"] => {
  if (type === "erasure") return "erasure-completed";
  if (type === "portability") return "portability-export";
  return "access-package";
};

export const fulfillDsr = (
  input: { dsrId: string; actorId: string; actor: DataGovernanceActor },
  deps: DataGovernanceDeps
) =>
  (async () => {
    const dsrs = await deps.port.listDsrs("");
    const dsr = dsrs.find((candidate) => candidate.dsrId === input.dsrId);
    if (!dsr) throw new Error(`DSR ${input.dsrId} not found`);
    if (dsr.state === "fulfilled") throw new Error(`DSR ${input.dsrId} already fulfilled`);
    const datasets = await deps.port.listDatasets();
    const classifications = await deps.port.listClassifications();
    const fulfilledAt = new Date().toISOString();
    await deps.audit.emit(
      createAuditEvent({
        actorId: input.actor.actorId,
        actorRoles: input.actor.actorRoles,
        tenantId: dsr.organisationId,
        action: AuditAction.DataGovernanceDsrFulfilled,
        resource: "data_governance_dsr",
        resourceId: input.dsrId,
        metadata: {
          before: { state: dsr.state },
          after: { state: "fulfilled", fulfilledAt },
          type: dsr.type,
          subjectId: dsr.subjectId,
        },
        sourceHost: input.actor.sourceHost,
      })
    );
    return deps.port.fulfillDsr({
      ...input,
      evidence: {
        fulfilledBy: input.actorId,
        fulfilledAt,
        action: actionForDsrType(dsr.type),
        datasets: datasets.map((dataset) => ({
          datasetId: dataset.datasetId,
          owner: dataset.owner,
          classification: dataset.classification,
          lineageEdges: dataset.lineageEdges,
        })),
        classifications: classifications.map((classification) => ({
          datasetId: classification.datasetId,
          columnName: classification.columnName,
          classification: classification.classification,
          rule: classification.rule,
        })),
      },
    });
  })();
