import type {
  ClassifyColumnInput,
  CreateDatasetEntryInput,
  CreateDsrInput,
  DataGovernancePort,
  DatasetClassification,
} from "../ports/data-governance.ts";
export const classifyByRules = (sample: string): DatasetClassification =>
  (() => {
    if (/card|cc|credit/i.test(sample)) return "sensitive";
    if (/@/.test(sample)) return "pii";
    if (/phone|ssn/i.test(sample)) return "sensitive";
    return "none";
  })();
export const createDataset = (input: CreateDatasetEntryInput, deps: { port: DataGovernancePort }) =>
  deps.port.createDataset(input);
export const classifyColumn = (input: ClassifyColumnInput, deps: { port: DataGovernancePort }) =>
  deps.port.classifyColumn(input);
export const createDsr = (input: CreateDsrInput, deps: { port: DataGovernancePort }) =>
  deps.port.createDsr(input);
export const fulfillDsr = (
  input: { dsrId: string; actorId: string },
  deps: { port: DataGovernancePort }
) => deps.port.fulfillDsr(input);
