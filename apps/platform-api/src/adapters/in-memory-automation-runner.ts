import type {
  AutomationRunInput,
  AutomationRunStatus,
  AutomationRunnerPort,
} from "../ports/automation-runner.ts";

interface RunRecord {
  status: AutomationRunStatus["status"];
  detail: string;
}

export class InMemoryAutomationRunner implements AutomationRunnerPort {
  private readonly runs = new Map<string, RunRecord>();

  async runScript(input: AutomationRunInput): Promise<{ runId: string }> {
    this.runs.set(input.runId, { status: "succeeded", detail: `script:${input.scriptKey}` });
    return { runId: input.runId };
  }

  async runFlow(input: AutomationRunInput): Promise<{ runId: string }> {
    this.runs.set(input.runId, { status: "succeeded", detail: `flow:${input.scriptKey}` });
    return { runId: input.runId };
  }

  async getRunStatus(runId: string): Promise<AutomationRunStatus> {
    const record = this.runs.get(runId);
    if (!record) throw new Error("run_not_found");
    return { runId, status: record.status, detail: record.detail };
  }

  async cancelRun(runId: string): Promise<void> {
    const record = this.runs.get(runId);
    if (!record) throw new Error("run_not_found");
    record.status = "cancelled";
    record.detail = "cancelled";
  }
}
