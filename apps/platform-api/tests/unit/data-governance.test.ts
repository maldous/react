import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  classifyByRules,
  classifyByRulesDetailed,
  classifyColumn,
  createDataset,
  createDsr,
  fulfillDsr,
} from "../../src/usecases/data-governance.ts";
import type {
  ClassifyColumnInput,
  CreateDatasetEntryInput,
  CreateDsrInput,
  DataClassificationRecord,
  DataGovernancePort,
  DatasetEntry,
  DsrRecord,
} from "../../src/ports/data-governance.ts";
import { AuditAction, createInMemoryAuditEventPort } from "@platform/audit-events";

const ACTOR = {
  actorId: "00000000-0000-0000-0000-000000000001",
  actorRoles: ["system-admin"],
  sourceHost: "aldous.info",
};

class InMemoryGovernancePort implements DataGovernancePort {
  datasets: DatasetEntry[] = [];
  classifications: DataClassificationRecord[] = [];
  dsrs: DsrRecord[] = [];

  async listDatasets() {
    return this.datasets;
  }

  async createDataset(input: CreateDatasetEntryInput) {
    const dataset: DatasetEntry = {
      datasetId: `dataset-${this.datasets.length + 1}`,
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
      classificationId: `classification-${this.classifications.length + 1}`,
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
      dsrId: `dsr-${this.dsrs.length + 1}`,
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

describe("data governance", () => {
  it("classifies PII and sensitive samples by deterministic rules", () => {
    assert.equal(classifyByRules("someone@example.com"), "pii");
    assert.deepEqual(classifyByRulesDetailed("111-22-3333"), {
      classification: "sensitive",
      rule: "sensitive.ssn",
    });
    assert.deepEqual(classifyByRulesDetailed("4111 1111 1111 1111"), {
      classification: "sensitive",
      rule: "sensitive.payment_card_luhn",
    });
    assert.equal(classifyByRulesDetailed("hello").classification, "none");
  });

  it("normalizes catalogue lineage and stores column classification decisions", async () => {
    const port = new InMemoryGovernancePort();
    const audit = createInMemoryAuditEventPort();
    const dataset = await createDataset(
      {
        owner: " finance ",
        classification: "pii",
        lineageEdges: ["crm.contacts", " billing.accounts ", "crm.contacts"],
        actorId: ACTOR.actorId,
        actor: ACTOR,
      },
      { port, audit }
    );
    assert.equal(dataset.owner, "finance");
    assert.deepEqual(dataset.lineageEdges, ["billing.accounts", "crm.contacts"]);
    const [datasetAudit] = await audit.query({
      tenantId: ACTOR.actorId,
      action: AuditAction.DataGovernanceDatasetCreated,
    });
    assert.equal(datasetAudit?.resourceId, "finance");

    const classification = await classifyColumn(
      {
        datasetId: dataset.datasetId,
        columnName: "customer_ssn",
        sampleValue: "111-22-3333",
        actorId: ACTOR.actorId,
        actor: ACTOR,
      },
      { port, audit }
    );
    assert.equal(classification.classification, "sensitive");
    assert.equal(classification.rule, "sensitive.ssn");
    const [classificationAudit] = await audit.query({
      tenantId: ACTOR.actorId,
      action: AuditAction.DataGovernanceColumnClassified,
    });
    assert.equal(classificationAudit?.resourceId, `${dataset.datasetId}:customer_ssn`);
  });

  it("fulfills DSRs with catalogue and classification evidence exactly once", async () => {
    const port = new InMemoryGovernancePort();
    const audit = createInMemoryAuditEventPort();
    const dataset = await createDataset(
      {
        owner: "support",
        classification: "pii",
        lineageEdges: ["crm.contacts"],
        actorId: ACTOR.actorId,
        actor: ACTOR,
      },
      { port, audit }
    );
    await classifyColumn(
      {
        datasetId: dataset.datasetId,
        columnName: "email",
        sampleValue: "subject@example.com",
        actorId: ACTOR.actorId,
        actor: ACTOR,
      },
      { port, audit }
    );
    const dsr = await createDsr(
      {
        organisationId: "00000000-0000-0000-0000-000000000002",
        subjectId: "subject-1",
        type: "access",
        reason: "subject access request",
        actorId: ACTOR.actorId,
        actor: ACTOR,
      },
      { port, audit }
    );
    const [createDsrAudit] = await audit.query({
      tenantId: "00000000-0000-0000-0000-000000000002",
      action: AuditAction.DataGovernanceDsrCreated,
    });
    assert.equal(createDsrAudit?.resourceId, "subject-1");

    const fulfilled = await fulfillDsr(
      {
        dsrId: dsr.dsrId,
        actorId: "00000000-0000-0000-0000-000000000003",
        actor: { ...ACTOR, actorId: "00000000-0000-0000-0000-000000000003" },
      },
      { port, audit }
    );
    assert.equal(fulfilled.state, "fulfilled");
    assert.equal(fulfilled.fulfillmentEvidence?.action, "access-package");
    assert.equal(fulfilled.fulfillmentEvidence?.datasets.length, 1);
    assert.equal(fulfilled.fulfillmentEvidence?.classifications[0]?.rule, "pii.email");
    const [fulfillAudit] = await audit.query({
      tenantId: "00000000-0000-0000-0000-000000000002",
      action: AuditAction.DataGovernanceDsrFulfilled,
    });
    assert.equal(fulfillAudit?.resourceId, dsr.dsrId);

    await assert.rejects(
      fulfillDsr(
        {
          dsrId: dsr.dsrId,
          actorId: "00000000-0000-0000-0000-000000000003",
          actor: { ...ACTOR, actorId: "00000000-0000-0000-0000-000000000003" },
        },
        { port, audit }
      ),
      /already fulfilled/
    );
  });
});
