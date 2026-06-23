import net from "node:net";
import { createLogger } from "@platform/platform-logging";
import { createTracer, withSpan } from "@platform/platform-observability";
import type { AntivirusPort, AntivirusScanInput } from "../ports/antivirus.ts";

const log = createLogger({
  name: "clamav-antivirus",
  service: "platform-api",
  boundedContext: "storage",
});
const tracer = createTracer("clamav-antivirus");
const clamAvMetrics = new Map<string, number>();

function metric(name: string, labels: Record<string, string>): void {
  const key = `${name}:${Object.entries(labels)
    .map(([k, v]) => `${k}=${v}`)
    .join(",")}`;
  clamAvMetrics.set(key, (clamAvMetrics.get(key) ?? 0) + 1);
}

export function getClamAvMetric(name: string, labels: Record<string, string>): number {
  const key = `${name}:${Object.entries(labels)
    .map(([k, v]) => `${k}=${v}`)
    .join(",")}`;
  return clamAvMetrics.get(key) ?? 0;
}

function finishSocketOperation(settled: { value: boolean }, timer: NodeJS.Timeout, fn: () => void) {
  if (settled.value) return;
  settled.value = true;
  clearTimeout(timer);
  fn();
}

export interface ClamAvAdapterOptions {
  host: string;
  port: number;
  timeoutMs?: number;
  retryAttempts?: number;
  retryBackoffMs?: number;
  tenantPrefix?: string;
  quotaBeforeWrite?: (input: { objectKey: string; sizeBytes: number }) => Promise<void>;
  legalHoldDeletionBlock?: (objectKey: string) => Promise<void>;
  auditEvent?: (event: {
    action: "clamav.scan.clean" | "clamav.scan.rejected" | "clamav.scan.failed";
    objectKey: string;
    verdict?: "clean" | "rejected";
    reason?: string;
  }) => Promise<void>;
}

export interface ClamAvConfig {
  host: string;
  port: number;
  timeoutMs: number;
  retryAttempts: number;
  retryBackoffMs: number;
  secretSource: "not-required";
}

export function loadClamAvConfig(env: NodeJS.ProcessEnv = process.env): ClamAvConfig {
  return {
    host: env["CLAMAV_HOST"] ?? "127.0.0.1",
    port: Number(env["CLAMAV_PORT"] ?? "3310"),
    timeoutMs: Number(env["CLAMAV_TIMEOUT_MS"] ?? "5000"),
    retryAttempts: Number(env["CLAMAV_RETRY_ATTEMPTS"] ?? "1"),
    retryBackoffMs: Number(env["CLAMAV_RETRY_BACKOFF_MS"] ?? "100"),
    secretSource: "not-required",
  };
}

export class ClamAvAdapter implements AntivirusPort {
  private readonly host: string;
  private readonly port: number;
  private readonly timeoutMs: number;
  private readonly retryAttempts: number;
  private readonly retryBackoffMs: number;
  private readonly tenantPrefix?: string;
  private readonly quotaBeforeWrite?: ClamAvAdapterOptions["quotaBeforeWrite"];
  private readonly legalHoldDeletionBlock?: ClamAvAdapterOptions["legalHoldDeletionBlock"];
  private readonly auditEvent?: ClamAvAdapterOptions["auditEvent"];

  constructor(options: ClamAvAdapterOptions) {
    this.host = options.host;
    this.port = options.port;
    this.timeoutMs = options.timeoutMs ?? 5_000;
    this.retryAttempts = options.retryAttempts ?? 1;
    this.retryBackoffMs = options.retryBackoffMs ?? 100;
    this.tenantPrefix = options.tenantPrefix;
    this.quotaBeforeWrite = options.quotaBeforeWrite;
    this.legalHoldDeletionBlock = options.legalHoldDeletionBlock;
    this.auditEvent = options.auditEvent;
  }

  async scan(
    input: AntivirusScanInput
  ): Promise<{ verdict: "clean" | "rejected"; reason?: string }> {
    this.assertTenantPrefixIsolation(input.objectKey);
    return withSpan(
      tracer,
      "clamav.scan",
      async () => {
        try {
          await this.quotaBeforeWrite?.({
            objectKey: input.objectKey,
            sizeBytes: input.body.length,
          });
          await this.legalHoldDeletionBlock?.(input.objectKey);
          const response = await this.withRetry(() => this.scanBuffer(input.body));
          if (/\bFOUND\b/.test(response)) {
            const rejected = { verdict: "rejected" as const, reason: response.trim() };
            metric("clamav_scan_total", { verdict: rejected.verdict });
            log.info(
              { objectKey: input.objectKey, verdict: rejected.verdict },
              "clamav.scan.complete"
            );
            await this.auditEvent?.({
              action: "clamav.scan.rejected",
              objectKey: input.objectKey,
              verdict: rejected.verdict,
              reason: rejected.reason,
            });
            return rejected;
          }
          if (/\bOK\b/.test(response)) {
            metric("clamav_scan_total", { verdict: "clean" });
            log.info({ objectKey: input.objectKey, verdict: "clean" }, "clamav.scan.complete");
            await this.auditEvent?.({
              action: "clamav.scan.clean",
              objectKey: input.objectKey,
              verdict: "clean",
            });
            return { verdict: "clean" };
          }
          throw new Error(`Unexpected ClamAV response: ${response.trim()}`);
        } catch (err) {
          metric("clamav_scan_total", { verdict: "failed" });
          log.error({ err, objectKey: input.objectKey }, "clamav.scan.failed");
          await this.auditEvent?.({
            action: "clamav.scan.failed",
            objectKey: input.objectKey,
            reason: err instanceof Error ? err.message : String(err),
          });
          throw err;
        }
      },
      { "storage.objectKey": input.objectKey }
    );
  }

  async healthCheck(): Promise<{ status: "ready"; provider: "clamav-antivirus" }> {
    const response = await this.withRetry(() => this.sendCommand("zPING\0"));
    if (!/\bPONG\b/.test(response)) {
      throw new Error(`ClamAV readiness probe failed closed: ${response.trim()}`);
    }
    return { status: "ready", provider: "clamav-antivirus" };
  }

  recoveryAction(): string {
    return "operator recovery: verify CLAMAV_HOST/CLAMAV_PORT/CLAMAV_TIMEOUT_MS, restart the antivirus-provider compose profile, confirm clamd signature updates, then retry quarantined object scans; storage downloads remain blocked until clean scan verdict";
  }

  private assertTenantPrefixIsolation(objectKey: string): void {
    if (!this.tenantPrefix) return;
    if (!objectKey.startsWith(this.tenantPrefix)) {
      throw new Error(
        `ClamAV tenantPrefix isolation rejected object key "${objectKey}" outside "${this.tenantPrefix}"`
      );
    }
  }

  private async withRetry<T>(operation: () => Promise<T>): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.retryAttempts; attempt += 1) {
      try {
        return await operation();
      } catch (err) {
        lastError = err;
        if (attempt >= this.retryAttempts) break;
        await new Promise((resolve) => setTimeout(resolve, this.retryBackoffMs * (attempt + 1)));
      }
    }
    throw new Error(
      `ClamAV unavailable; no fallback is allowed for malware scanning, fail-closed after retry attempts: ${
        lastError instanceof Error ? lastError.message : String(lastError)
      }`
    );
  }

  private sendCommand(command: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection({ host: this.host, port: this.port });
      let response = "";
      const settled = { value: false };
      const timer = setTimeout(() => {
        socket.destroy();
        finishSocketOperation(settled, timer, () => reject(new Error("ClamAV command timed out")));
      }, this.timeoutMs);

      socket.on("connect", () => {
        socket.write(command);
      });
      socket.on("data", (chunk) => {
        response += chunk.toString("utf8");
      });
      socket.on("error", (err) => {
        finishSocketOperation(settled, timer, () => reject(err));
      });
      socket.on("close", () => {
        finishSocketOperation(settled, timer, () => resolve(response));
      });
    });
  }

  private scanBuffer(body: Buffer): Promise<string> {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection({ host: this.host, port: this.port });
      let response = "";
      const settled = { value: false };
      const timer = setTimeout(() => {
        socket.destroy();
        finishSocketOperation(settled, timer, () => reject(new Error("ClamAV scan timed out")));
      }, this.timeoutMs);

      socket.on("connect", () => {
        socket.write("zINSTREAM\0");
        for (let offset = 0; offset < body.length; offset += 8192) {
          const chunk = body.subarray(offset, offset + 8192);
          const size = Buffer.alloc(4);
          size.writeUInt32BE(chunk.length, 0);
          socket.write(size);
          socket.write(chunk);
        }
        socket.write(Buffer.alloc(4));
      });
      socket.on("data", (chunk) => {
        response += chunk.toString("utf8");
      });
      socket.on("error", (err) => {
        finishSocketOperation(settled, timer, () => reject(err));
      });
      socket.on("close", () => {
        finishSocketOperation(settled, timer, () => resolve(response));
      });
    });
  }
}
