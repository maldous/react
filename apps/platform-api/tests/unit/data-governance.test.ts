import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { classifyByRules, createDataset } from "../../src/usecases/data-governance.ts";

describe("data governance", () => {
  it("classifies samples by rules", () => {
    assert.equal(classifyByRules("someone@example.com"), "pii");
    assert.equal(classifyByRules("111-22-3333"), "none");
    assert.equal(classifyByRules("card 4111 1111 1111 1111"), "sensitive");
    assert.equal(classifyByRules("hello"), "none");
  });

  it("delegates createDataset to the port", async () => {
    let called = false;
    const result = await createDataset(
      { owner: "finance", classification: "pii", actorId: "u1" },
      {
        port: {
          listDatasets: async () => [],
          createDataset: async (input: { owner: string; classification: string }) => {
            called = true;
            return {
              datasetId: "d1",
              owner: input.owner,
              classification: input.classification,
              lineageEdges: [],
              createdAt: null,
            };
          },
          classifyColumn: async () => ({
            classificationId: "c1",
            datasetId: "d1",
            columnName: "email",
            classification: "pii",
            rule: "rules-based",
            createdAt: null,
          }),
          listClassifications: async () => [],
          listDsrs: async () => [],
          createDsr: async () => ({
            dsrId: "x",
            organisationId: "o",
            subjectId: "s",
            type: "access",
            state: "open",
            reason: "reason",
            createdAt: null,
            fulfilledAt: null,
          }),
          fulfillDsr: async () => ({
            dsrId: "x",
            organisationId: "o",
            subjectId: "s",
            type: "access",
            state: "fulfilled",
            reason: "reason",
            createdAt: null,
            fulfilledAt: null,
          }),
        },
      }
    );
    assert.equal(called, true);
    assert.equal(result.owner, "finance");
  });
});
