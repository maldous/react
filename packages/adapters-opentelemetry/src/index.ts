import { trace, type Tracer } from "@opentelemetry/api";

export const packageName = "@platform/adapters-opentelemetry";

export interface OtelSdkConfig {
  serviceName: string;
  serviceVersion: string;
  enabled?: boolean;
  exporterUrl?: string;
}

export class OtelSdkAdapter {
  private readonly enabled: boolean;
  private readonly serviceName: string;
  private readonly serviceVersion: string;

  constructor(config: OtelSdkConfig) {
    this.enabled = config.enabled ?? true;
    this.serviceName = config.serviceName;
    this.serviceVersion = config.serviceVersion;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  getTracer(): Tracer {
    return trace.getTracer(this.serviceName, this.serviceVersion);
  }

  async shutdown(): Promise<void> {
    // No-op when using the API-only package without a registered SDK provider.
    // Replace with provider.shutdown() when @opentelemetry/sdk-node is wired.
  }
}

export function createOtelSdkAdapter(config: OtelSdkConfig): OtelSdkAdapter {
  return new OtelSdkAdapter(config);
}
