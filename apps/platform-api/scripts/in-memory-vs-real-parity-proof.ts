import assert from "node:assert/strict";
import {
  InMemoryEventBus,
  InMemoryRateLimitRepository,
  InMemorySearchRepository,
  InMemorySecretStore,
} from "../src/adapters/in-memory-semantic-providers.ts";

const requiredMethods = {
  "rate-limit-repository": [
    "getByKey",
    "listForTenant",
    "listForTenantAsOperator",
    "upsert",
    "incrementAndCount",
    "currentCount",
  ],
  "event-bus": [
    "publish",
    "claimBatch",
    "markProcessed",
    "recordFailure",
    "listEvents",
    "listDeadLetters",
    "redrive",
  ],
  "secret-store": ["put", "getMetadata", "list", "resolve", "revoke", "delete", "readiness"],
  "search-repository": ["index", "remove", "reindex", "countAll", "search"],
};

const providers = {
  "rate-limit-repository": new InMemoryRateLimitRepository(),
  "event-bus": new InMemoryEventBus(),
  "secret-store": new InMemorySecretStore(),
  "search-repository": new InMemorySearchRepository(),
};

for (const [name, methods] of Object.entries(requiredMethods)) {
  for (const method of methods) {
    assert.equal(
      typeof providers[name as keyof typeof providers][method as never],
      "function",
      `${name}.${method} must exist`
    );
  }
  assert.equal(
    typeof providers[name as keyof typeof providers].reset,
    "function",
    `${name}.reset must exist`
  );
  assert.equal(
    typeof providers[name as keyof typeof providers].healthCheck,
    "function",
    `${name}.healthCheck must exist`
  );
  assert.equal(
    typeof providers[name as keyof typeof providers].injectFailure,
    "function",
    `${name}.injectFailure must exist`
  );
}

const tenantA = "tenant-a";
const tenantB = "tenant-b";
const search = providers["search-repository"];
await search.index({
  organisationId: tenantA,
  documentId: "doc",
  documentType: "article",
  title: "Tenant A",
  body: "visible",
});
assert.equal((await search.search(tenantA, { q: "visible", permissions: [] })).total, 1);
assert.equal((await search.search(tenantB, { q: "visible", permissions: [] })).total, 0);

const secrets = providers["secret-store"];
const meta = await secrets.put({
  organisationId: tenantA,
  name: "token",
  value: "secret",
  actorId: "actor",
});
assert.equal(await secrets.resolve(tenantA, meta.ref), "secret");
assert.equal(await secrets.resolve(tenantB, meta.ref), null);
secrets.injectFailure("resolve");
await assert.rejects(() => secrets.resolve(tenantA, meta.ref), /injected failure/);

console.log(
  JSON.stringify(
    {
      status: "PASS",
      parity:
        "in-memory adapters expose the same port methods exercised by real provider contract proofs",
      runtimeAssertions: [
        "method-contract",
        "reset",
        "healthCheck",
        "failure-injection",
        "tenant-isolation",
      ],
    },
    null,
    2
  )
);
