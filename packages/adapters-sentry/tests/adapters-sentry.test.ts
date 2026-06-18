import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  SentryErrorAdapter,
  createSentryAdapter,
  correlationTagsFrom,
  type SentryModuleLike,
} from "../src/index.ts";

// A fake @sentry/node whose import resolution is controlled by the test, so the
// enabled init lifecycle is exercised with no real DSN or network.
function makeFakeSentry() {
  const calls = {
    init: 0,
    captureException: [] as Error[],
    flush: [] as number[],
  };
  const mod: SentryModuleLike = {
    init: () => {
      calls.init += 1;
    },
    captureException: (error: Error) => {
      calls.captureException.push(error);
      return "event-id";
    },
    captureMessage: () => "msg-id",
    setUser: () => {},
    flush: (timeout?: number) => {
      calls.flush.push(timeout ?? -1);
      return Promise.resolve(true);
    },
  };
  // A manually-resolvable importer: the test decides WHEN the dynamic import
  // resolves, modelling "capture requested before the import finishes".
  let resolveImport!: (m: SentryModuleLike) => void;
  let rejectImport!: (e: Error) => void;
  const importPromise = new Promise<SentryModuleLike>((res, rej) => {
    resolveImport = res;
    rejectImport = rej;
  });
  return {
    calls,
    mod,
    importSentry: () => importPromise,
    resolve: () => resolveImport(mod),
    reject: (e: Error) => rejectImport(e),
  };
}

const ENABLED = { dsn: "https://k@example.test/1", environment: "test", enabled: true };

describe("SentryErrorAdapter", () => {
  it("constructs without error when disabled", () => {
    const adapter = createSentryAdapter({ dsn: "", environment: "test", enabled: false });
    assert.ok(adapter instanceof SentryErrorAdapter);
  });

  it("captureError returns undefined when disabled", () => {
    const adapter = createSentryAdapter({ dsn: "", environment: "test", enabled: false });
    const result = adapter.captureError(new Error("test error"));
    assert.strictEqual(result, undefined);
  });

  it("captureMessage returns undefined when disabled", () => {
    const adapter = createSentryAdapter({ dsn: "", environment: "test", enabled: false });
    const result = adapter.captureMessage("test message", "warning");
    assert.strictEqual(result, undefined);
  });

  it("setUser does not throw when disabled", () => {
    const adapter = createSentryAdapter({ dsn: "", environment: "test", enabled: false });
    assert.doesNotThrow(() => adapter.setUser({ id: "user-1", email: "u@a.com" }));
  });

  it("flush returns true when disabled", async () => {
    const adapter = createSentryAdapter({ dsn: "", environment: "test", enabled: false });
    const result = await adapter.flush();
    assert.strictEqual(result, true);
  });
});

// ADR-ACT-0290 — explicit initialisation lifecycle (removing the fire-and-forget race).
describe("SentryErrorAdapter init lifecycle", () => {
  it("drops capture requested before the dynamic import resolves, then captures after ready()", async () => {
    const fake = makeFakeSentry();
    const adapter = createSentryAdapter(ENABLED, { importSentry: fake.importSentry });

    // Import has NOT resolved yet → best-effort request-path capture is a no-op.
    assert.equal(adapter.isInitialised(), false);
    assert.equal(adapter.captureError(new Error("early")), undefined);
    assert.equal(fake.calls.captureException.length, 0);

    fake.resolve();
    await adapter.ready();

    assert.equal(adapter.isInitialised(), true);
    assert.equal(adapter.captureError(new Error("late")), "event-id");
    assert.equal(fake.calls.captureException.length, 1);
  });

  it("initialises the SDK exactly once across repeated start()/ready() calls (idempotent)", async () => {
    const fake = makeFakeSentry();
    const adapter = new SentryErrorAdapter(ENABLED, { importSentry: fake.importSentry });
    adapter.start();
    adapter.start();
    const pending = adapter.ready();
    fake.resolve();
    await pending;
    await adapter.ready();
    await adapter.ready();
    assert.equal(fake.calls.init, 1);
  });

  it("surfaces an initialisation failure via onInitError and never rejects ready()", async () => {
    const fake = makeFakeSentry();
    const seen: Error[] = [];
    const adapter = new SentryErrorAdapter(ENABLED, {
      importSentry: fake.importSentry,
      onInitError: (e) => seen.push(e),
    });
    adapter.start();
    fake.reject(new Error("sdk import boom"));
    await assert.doesNotReject(() => adapter.ready());
    assert.equal(adapter.isInitialised(), false);
    assert.equal(seen.length, 1);
    assert.match(adapter.getInitError()?.message ?? "", /sdk import boom/);
    // flush after a failed init is an honest no-op success (nothing to flush).
    assert.equal(await adapter.flush(10), true);
  });

  it("is a fast no-op when disabled (no import, ready resolves, flush true)", async () => {
    let imported = false;
    const adapter = new SentryErrorAdapter(
      { dsn: "", environment: "test", enabled: false },
      {
        importSentry: () => {
          imported = true;
          return Promise.reject(new Error("should not import"));
        },
      }
    );
    adapter.start();
    await adapter.ready();
    assert.equal(imported, false);
    assert.equal(adapter.captureError(new Error("x")), undefined);
    assert.equal(await adapter.flush(), true);
  });

  it("fatal-startup ordering: ready() before capture, flush actually flushes", async () => {
    const fake = makeFakeSentry();
    const adapter = new SentryErrorAdapter(ENABLED, { importSentry: fake.importSentry });
    // Model the fatal path in http.ts: trigger init, then on the catch path await
    // ready() BEFORE capture, then flush.
    adapter.start();
    fake.resolve();
    await adapter.ready();
    const id = adapter.captureError(new Error("fatal startup"));
    const flushed = await adapter.flush(2000);
    assert.equal(id, "event-id");
    assert.equal(fake.calls.captureException.length, 1);
    assert.equal(flushed, true);
    assert.deepEqual(fake.calls.flush, [2000]);
  });

  it("flush awaits a still-pending init instead of falsely reporting success", async () => {
    const fake = makeFakeSentry();
    const adapter = new SentryErrorAdapter(ENABLED, { importSentry: fake.importSentry });
    adapter.start();
    // Kick off flush while init is still pending; it must not resolve until init does.
    let flushResolved = false;
    const flushPromise = adapter.flush(2000).then((r) => {
      flushResolved = true;
      return r;
    });
    await Promise.resolve();
    assert.equal(flushResolved, false, "flush resolved before init completed");
    fake.resolve();
    assert.equal(await flushPromise, true);
    assert.deepEqual(fake.calls.flush, [2000]);
  });
});

// ADR-ACT-0285 Phase 5.5 — the producer enrichment that makes a captured event
// searchable in the Sentry API by the same correlation ids the log line carries.
describe("correlationTagsFrom", () => {
  it("promotes requestId/testRunId/scenarioId to searchable tags", () => {
    const tags = correlationTagsFrom({
      requestId: "req-1",
      testRunId: "trid-1",
      scenarioId: "scn-1",
    });
    assert.deepEqual(tags, { requestId: "req-1", testRunId: "trid-1", scenarioId: "scn-1" });
  });

  it("ignores non-correlation keys and empty/non-string values", () => {
    const tags = correlationTagsFrom({
      requestId: "req-1",
      tenantId: "should-not-leak",
      testRunId: "",
      scenarioId: 42 as unknown as string,
    });
    assert.deepEqual(tags, { requestId: "req-1" });
  });

  it("returns an empty object for missing context", () => {
    assert.deepEqual(correlationTagsFrom(undefined), {});
    assert.deepEqual(correlationTagsFrom({}), {});
  });
});
