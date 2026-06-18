import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { type AuditEvent, type AuditEventPort } from "@platform/audit-events";
import {
  getSearchReadiness,
  indexDocument,
  reindexTenant,
  removeDocument,
  searchProducts,
} from "../../src/usecases/search.ts";
import type {
  SearchDocumentInput,
  SearchIndexPort,
  SearchQueryInput,
  SearchQueryPort,
  SearchQueryResult,
} from "../../src/ports/search-repository.ts";

const ORG = "11111111-1111-1111-1111-111111111111";
const ACTOR = { actorId: "op", actorRoles: ["system-admin"] };

// In-memory store implementing both search ports, with the same tenant-scope +
// permission-filter contract as the Postgres adapter (token substring match).
function fakeSearch(): SearchIndexPort &
  SearchQueryPort & { _docs: Map<string, SearchDocumentInput> } {
  const docs = new Map<string, SearchDocumentInput>();
  const key = (o: string, t: string, d: string) => `${o}|${t}|${d}`;
  return {
    _docs: docs,
    async index(input) {
      docs.set(key(input.organisationId, input.documentType, input.documentId), input);
    },
    async remove(o, t, d) {
      return docs.delete(key(o, t, d));
    },
    async reindex(o) {
      return [...docs.values()].filter((x) => x.organisationId === o).length;
    },
    async countAll() {
      return docs.size;
    },
    async search(o: string, input: SearchQueryInput): Promise<SearchQueryResult> {
      const ql = input.q.toLowerCase();
      const hits = [...docs.values()]
        .filter((x) => x.organisationId === o)
        .filter((x) => !input.documentType || x.documentType === input.documentType)
        .filter((x) => `${x.title} ${x.body}`.toLowerCase().includes(ql))
        .filter((x) => x.permissionKey == null || input.permissions.includes(x.permissionKey))
        .map((x) => ({
          documentId: x.documentId,
          documentType: x.documentType,
          title: x.title,
          url: x.url ?? null,
          score: 1,
        }));
      return { hits, total: hits.length };
    },
  };
}

function capturingAudit(): { port: AuditEventPort; events: AuditEvent[] } {
  const events: AuditEvent[] = [];
  return {
    events,
    port: {
      emit: async (e) => {
        events.push(e);
      },
      query: async () => events,
    },
  };
}

function deps() {
  const repo = fakeSearch();
  const audit = capturingAudit();
  return { repo, audit, deps: { index: repo, query: repo, audit: audit.port } };
}

describe("search usecase", () => {
  it("rejects documents carrying secret-looking metadata keys", async () => {
    const { deps: d } = deps();
    await assert.rejects(
      indexDocument(
        {
          organisationId: ORG,
          documentId: "1",
          documentType: "product",
          title: "x",
          body: "y",
          metadata: { api_key: "leak" },
        },
        d
      )
    );
  });

  it("rejects a document with an empty title", async () => {
    const { deps: d } = deps();
    await assert.rejects(
      indexDocument(
        { organisationId: ORG, documentId: "1", documentType: "product", title: "  ", body: "y" },
        d
      )
    );
  });

  it("rejects an empty query", async () => {
    const { deps: d } = deps();
    await assert.rejects(searchProducts(ORG, { q: "   " }, [], d));
  });

  it("returns matching documents and no body/secret fields", async () => {
    const { deps: d } = deps();
    await indexDocument(
      {
        organisationId: ORG,
        documentId: "p1",
        documentType: "product",
        title: "Blue widget",
        body: "a sturdy widget",
      },
      d
    );
    const res = await searchProducts(ORG, { q: "widget" }, [], d);
    assert.equal(res.total, 1);
    assert.equal(res.hits[0]?.documentId, "p1");
    assert.equal("body" in (res.hits[0] as object), false);
  });

  it("applies the permission filter", async () => {
    const { deps: d } = deps();
    await indexDocument(
      {
        organisationId: ORG,
        documentId: "s1",
        documentType: "doc",
        title: "secret plan",
        body: "restricted",
        permissionKey: "docs.restricted.read",
      },
      d
    );
    // Without the permission → not returned.
    assert.equal((await searchProducts(ORG, { q: "plan" }, [], d)).total, 0);
    // With it → returned.
    assert.equal((await searchProducts(ORG, { q: "plan" }, ["docs.restricted.read"], d)).total, 1);
  });

  it("removed documents disappear from results", async () => {
    const { deps: d } = deps();
    await indexDocument(
      { organisationId: ORG, documentId: "p1", documentType: "product", title: "widget", body: "" },
      d
    );
    assert.equal((await searchProducts(ORG, { q: "widget" }, [], d)).total, 1);
    assert.equal(await removeDocument(ORG, "product", "p1", d), true);
    assert.equal((await searchProducts(ORG, { q: "widget" }, [], d)).total, 0);
  });

  it("reindex is audited and returns the document count", async () => {
    const { deps: d, audit } = deps();
    await indexDocument(
      { organisationId: ORG, documentId: "p1", documentType: "product", title: "widget", body: "" },
      d
    );
    const r = await reindexTenant({ organisationId: ORG, actor: ACTOR }, d);
    assert.equal(r.reindexed, 1);
    assert.equal(audit.events[0]?.resource, "search");
  });

  it("readiness reports degraded when empty, ready with docs", async () => {
    const { deps: d } = deps();
    assert.equal((await getSearchReadiness(d)).status, "degraded");
    await indexDocument(
      { organisationId: ORG, documentId: "p1", documentType: "product", title: "widget", body: "" },
      d
    );
    assert.equal((await getSearchReadiness(d)).status, "ready");
  });
});
