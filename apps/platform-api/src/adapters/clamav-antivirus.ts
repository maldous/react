import net from "node:net";
import type { AntivirusPort, AntivirusScanInput } from "../ports/antivirus.ts";

export interface ClamAvAdapterOptions {
  host: string;
  port: number;
  timeoutMs?: number;
}

export class ClamAvAdapter implements AntivirusPort {
  private readonly host: string;
  private readonly port: number;
  private readonly timeoutMs: number;

  constructor(options: ClamAvAdapterOptions) {
    this.host = options.host;
    this.port = options.port;
    this.timeoutMs = options.timeoutMs ?? 5_000;
  }

  async scan(
    input: AntivirusScanInput
  ): Promise<{ verdict: "clean" | "rejected"; reason?: string }> {
    const response = await this.scanBuffer(input.body);
    if (/\bFOUND\b/.test(response)) {
      return { verdict: "rejected", reason: response.trim() };
    }
    if (/\bOK\b/.test(response)) return { verdict: "clean" };
    throw new Error(`Unexpected ClamAV response: ${response.trim()}`);
  }

  private scanBuffer(body: Buffer): Promise<string> {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection({ host: this.host, port: this.port });
      let response = "";
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new Error("ClamAV scan timed out"));
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
        clearTimeout(timer);
        reject(err);
      });
      socket.on("close", () => {
        clearTimeout(timer);
        resolve(response);
      });
    });
  }
}
