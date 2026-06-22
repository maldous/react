import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  InMemoryAutomationRunner,
  loadInMemoryAutomationRunnerConfig,
} from "../../src/adapters/in-memory-automation-runner.ts";

describe("InMemoryAutomationRunner provider reliability", () => {
  it("loads provider config from explicit environment sources", () => {
    const config = loadInMemoryAutomationRunnerConfig({
      IN_MEMORY_AUTOMATION_RUNNER_TIMEOUT_MS: "125",
      IN_MEMORY_AUTOMATION_RUNNER_RETRY_ATTEMPTS: "2",
      IN_MEMORY_AUTOMATION_RUNNER_RETRY_BACKOFF_MS: "5",
    });

    assert.equal(config.enabled, true);
    assert.equal(config.operationTimeoutMs, 125);
    assert.equal(config.retryAttempts, 2);
    assert.equal(config.retryBackoffMs, 5);
    assert.match(config.configSource, /process\.env/);
    assert.match(config.secretSource, /no secret/i);
    assert.match(config.fallbackRationale, /no fallback|fail closed/i);
  });

  it("runs scripts and flows, reports status, and cancels runs", async () => {
    const runner = new InMemoryAutomationRunner();

    assert.deepEqual(
      await runner.runScript({
        scriptKey: "tenant.export",
        tenantId: "tenant-a",
        runId: "script-run-1",
        payload: { reason: "audit" },
      }),
      { runId: "script-run-1" }
    );
    assert.deepEqual(await runner.getRunStatus("script-run-1"), {
      runId: "script-run-1",
      status: "succeeded",
      detail: "script:tenant.export",
    });

    await runner.runFlow({
      scriptKey: "tenant.delete",
      tenantId: "tenant-a",
      runId: "flow-run-1",
      payload: {},
    });
    assert.deepEqual(await runner.getRunStatus("flow-run-1"), {
      runId: "flow-run-1",
      status: "succeeded",
      detail: "flow:tenant.delete",
    });

    const health = await runner.healthCheck();
    assert.equal(health.ok, true);
    assert.equal(health.ok && health.runCount, 2);

    await runner.cancelRun("flow-run-1");
    assert.deepEqual(await runner.getRunStatus("flow-run-1"), {
      runId: "flow-run-1",
      status: "cancelled",
      detail: "cancelled",
    });
  });

  it("fails closed when disabled or run id is unknown", async () => {
    const runner = new InMemoryAutomationRunner();
    await assert.rejects(() => runner.getRunStatus("missing-run"), /run_not_found/);

    const disabled = new InMemoryAutomationRunner({
      ...loadInMemoryAutomationRunnerConfig({}),
      enabled: false,
    });
    await assert.rejects(
      () =>
        disabled.runScript({
          scriptKey: "tenant.export",
          tenantId: "tenant-a",
          runId: "disabled-run",
          payload: {},
        }),
      /fail closed/i
    );
    assert.equal((await disabled.healthCheck()).ok, false);
    assert.match(disabled.recoveryAction(), /operator recovery|repair|retry/i);
  });
});
