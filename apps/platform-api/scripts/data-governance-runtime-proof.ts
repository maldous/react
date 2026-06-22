import { strict as assert } from "node:assert";
import {
  classifyByRulesDetailed,
  classifyColumn,
  createDataset,
  createDsr,
  fulfillDsr,
} from "../src/usecases/data-governance.ts";
import type {
  ClassifyColumnInput,
  CreateDatasetEntryInput,
  CreateDsrInput,
  DataClassificationRecord,
  DataGovernancePort,
  DatasetEntry,
  DsrRecord,
} from "../src/ports/data-governance.ts";
import { routes } from "../src/server/routes.ts";

class ProofGovernancePort implements DataGovernancePort {
  datasets: DatasetEntry[] = [];
  classifications: DataClassificationRecord[] = [];
  dsrs: DsrRecord[] = [];

  async listDatasets() {
    return this.datasets;
  }

  async createDataset(input: CreateDatasetEntryInput) {
    const dataset: DatasetEntry = {
      datasetId: `proof-dataset-${this.datasets.length + 1}`,
      owner: input.owner,
      classification: input.classification,
      lineageEdges: input.lineageEdges ?? [],
      createdAt: new Date(0).toISOString(),
    };
    this.datasets.push(dataset);
    return dataset;
  }

  async classifyColumn(input: ClassifyColumnInput) {
    const record: DataClassificationRecord = {
      classificationId: `proof-classification-${this.classifications.length + 1}`,
      datasetId: input.datasetId,
      columnName: input.columnName,
      classification: input.classification ?? "none",
      rule: input.rule ?? "none.no_match",
      createdAt: new Date(0).toISOString(),
    };
    this.classifications.push(record);
    return record;
  }

  async listClassifications(datasetId?: string) {
    return datasetId
      ? this.classifications.filter((classification) => classification.datasetId === datasetId)
      : this.classifications;
  }

  async listDsrs(organisationId: string) {
    return organisationId
      ? this.dsrs.filter((dsr) => dsr.organisationId === organisationId)
      : this.dsrs;
  }

  async createDsr(input: CreateDsrInput) {
    const dsr: DsrRecord = {
      dsrId: `proof-dsr-${this.dsrs.length + 1}`,
      organisationId: input.organisationId,
      subjectId: input.subjectId,
      type: input.type,
      state: "open",
      reason: input.reason,
      createdAt: new Date(0).toISOString(),
      fulfilledAt: null,
      fulfillmentEvidence: null,
    };
    this.dsrs.push(dsr);
    return dsr;
  }

  async fulfillDsr(input: Parameters<DataGovernancePort["fulfillDsr"]>[0]) {
    const dsr = this.dsrs.find((candidate) => candidate.dsrId === input.dsrId);
    if (!dsr || dsr.state !== "open") throw new Error("not found or already fulfilled");
    dsr.state = "fulfilled";
    dsr.fulfilledAt = input.evidence.fulfilledAt;
    dsr.fulfillmentEvidence = input.evidence;
    return dsr;
  }
}

async function main(): Promise<void> {
  const required = [
    "/api/admin/governance/catalog",
    "/api/admin/governance/catalog/classify",
    "/api/admin/governance/dsr",
    "/api/admin/governance/dsr/:dsrId/fulfill",
  ];
  for (const path of required)
    assert.ok(
      routes.some((r) => r.path === path),
      `governance route registered: ${path}`
    );

  assert.deepEqual(classifyByRulesDetailed("111-22-3333"), {
    classification: "sensitive",
    rule: "sensitive.ssn",
  });
  assert.equal(classifyByRulesDetailed("jane@example.com").rule, "pii.email");

  const port = new ProofGovernancePort();
  const dataset = await createDataset(
    {
      owner: " analytics ",
      classification: "pii",
      lineageEdges: ["raw.crm.contacts", "warehouse.customer_360", "raw.crm.contacts"],
      actorId: "00000000-0000-0000-0000-000000000001",
    },
    { port }
  );
  assert.deepEqual(dataset.lineageEdges, ["raw.crm.contacts", "warehouse.customer_360"]);

  const classification = await classifyColumn(
    {
      datasetId: dataset.datasetId,
      columnName: "card_number",
      sampleValue: "4111 1111 1111 1111",
      actorId: "00000000-0000-0000-0000-000000000001",
    },
    { port }
  );
  assert.equal(classification.classification, "sensitive");
  assert.equal(classification.rule, "sensitive.payment_card_luhn");

  const dsr = await createDsr(
    {
      organisationId: "00000000-0000-0000-0000-000000000002",
      subjectId: "subject-1",
      type: "portability",
      reason: "subject portability request",
      actorId: "00000000-0000-0000-0000-000000000001",
    },
    { port }
  );
  const fulfilled = await fulfillDsr(
    { dsrId: dsr.dsrId, actorId: "00000000-0000-0000-0000-000000000003" },
    { port }
  );
  assert.equal(fulfilled.state, "fulfilled");
  assert.equal(fulfilled.fulfillmentEvidence?.action, "portability-export");
  assert.equal(fulfilled.fulfillmentEvidence?.datasets[0]?.owner, "analytics");
  assert.equal(
    fulfilled.fulfillmentEvidence?.classifications[0]?.rule,
    "sensitive.payment_card_luhn"
  );

  console.log(
    JSON.stringify(
      {
        capability: "V1C-13",
        result: "PASSED",
        semantics: [
          "catalogue lineage edges normalized and queryable",
          "PII and sensitive classification rules prove SSN/email/card handling",
          "DSR open-to-fulfilled workflow records fulfilment evidence",
          "governance routes include catalogue, classification, DSR create/list and fulfil",
        ],
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
