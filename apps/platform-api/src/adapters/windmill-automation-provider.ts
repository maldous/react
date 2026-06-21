import type {
  AutomationRunInput,
  AutomationRunStatus,
  AutomationRunnerPort,
} from "../ports/automation-runner.ts";
import { json, type FetchLike } from "./http-engine-provider.ts";

export class WindmillAutomationProviderAdapter implements AutomationRunnerPort {
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;

  constructor(baseUrl: string, fetchImpl: FetchLike = fetch) {
    this.baseUrl = baseUrl;
    this.fetchImpl = fetchImpl;
  }

  async runScript(input: AutomationRunInput): Promise<{ runId: string }> {
    return json<{ runId: string }>(this.fetchImpl, `${this.baseUrl}/api/run-script`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  async runFlow(input: AutomationRunInput): Promise<{ runId: string }> {
    return json<{ runId: string }>(this.fetchImpl, `${this.baseUrl}/api/run-flow`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  async getRunStatus(runId: string): Promise<AutomationRunStatus> {
    return json<AutomationRunStatus>(
      this.fetchImpl,
      `${this.baseUrl}/api/runs/${encodeURIComponent(runId)}`
    );
  }

  async cancelRun(runId: string): Promise<void> {
    await json(this.fetchImpl, `${this.baseUrl}/api/runs/${encodeURIComponent(runId)}/cancel`, {
      method: "POST",
      body: JSON.stringify({ runId }),
    });
  }
}
