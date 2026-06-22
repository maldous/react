import net from "node:net";
import type { AntivirusPort, AntivirusScanInput } from "../ports/antivirus.ts";

export interface ClamAvAdapterOptions {
  host: string;
  port: number;
  timeoutMs?: number;
  retryAttempts?: number;
  retryBackoffMs?: number;
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

  constructor(options: ClamAvAdapterOptions) {
    this.host = options.host;
    this.port = options.port;
    this.timeoutMs = options.timeoutMs ?? 5_000;
    this.retryAttempts = options.retryAttempts ?? 1;
    this.retryBackoffMs = options.retryBackoffMs ?? 100;
  }

  async scan(
    input: AntivirusScanInput
  ): Promise<{ verdict: "clean" | "rejected"; reason?: string }> {
    const response = await this.withRetry(() => this.scanBuffer(input.body));
    if (/\bFOUND\b/.test(response)) {
      return { verdict: "rejected", reason: response.trim() };
    }
    if (/\bOK\b/.test(response)) return { verdict: "clean" };
    throw new Error(`Unexpected ClamAV response: ${response.trim()}`);
  }

  async healthCheck(): Promise<{ status: "ready"; provider: "clamav-antivirus" }> {
    const response = await this.withRetry(() => this.sendCommand("zPING\0"));
    if (!/\bPONG\b/.test(response)) {
      throw new Error(`ClamAV readiness probe failed closed: ${response.trim()}`);
    }
    return { status: "ready", provider: "clamav-antivirus" };
  }

  recoveryAction(): string {
    return "operator recovery: verify CLAMAV_HOST/CLAMAV_PORT/CLAMAV_TIMEOUT_MS, restart the antivirus-provider compose profile, confirm clamd signature updates, then retry quarantined object scans";
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
      let settled = false;
      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn();
      };
      const timer = setTimeout(() => {
        socket.destroy();
        finish(() => reject(new Error("ClamAV command timed out")));
      }, this.timeoutMs);

      socket.on("connect", () => {
        socket.write(command);
      });
      socket.on("data", (chunk) => {
        response += chunk.toString("utf8");
      });
      socket.on("error", (err) => {
        finish(() => reject(err));
      });
      socket.on("close", () => {
        finish(() => resolve(response));
      });
    });
  }

  private scanBuffer(body: Buffer): Promise<string> {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection({ host: this.host, port: this.port });
      let response = "";
      let settled = false;
      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn();
      };
      const timer = setTimeout(() => {
        socket.destroy();
        finish(() => reject(new Error("ClamAV scan timed out")));
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
        finish(() => reject(err));
      });
      socket.on("close", () => {
        finish(() => resolve(response));
      });
    });
  }
}
