import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Local-env loader for runtime proof scripts (ADR-ACT-0223).
//
// Proof scripts run as plain `node` (no dotenv), so they don't see the local
// service credentials the operator keeps in `.env` / `.env.dev`. This loads those
// files into process.env for keys that are NOT already set, so a proof can probe
// the real local stack (MinIO/Loki/Grafana/etc.) without hardcoding secrets. It
// NEVER overrides an explicit process.env value, and never prints values.
// ---------------------------------------------------------------------------

function parseEnvFile(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of readFileSync(path, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

/**
 * Load `.env` then `.env.<envName>` (override) from the repo root into process.env,
 * only for keys that are currently unset. Returns the list of files actually loaded.
 */
export function loadLocalEnv(envName = process.env["ENV"] ?? "dev"): string[] {
  const root = process.cwd();
  const loaded: string[] = [];
  for (const file of [".env", `.env.${envName}`]) {
    const path = join(root, file);
    if (!existsSync(path)) continue;
    const parsed = parseEnvFile(path);
    for (const [k, v] of Object.entries(parsed)) {
      if (process.env[k] === undefined) process.env[k] = v;
    }
    loaded.push(file);
  }
  return loaded;
}

/** Resolve local S3/MinIO config from S3_* → MINIO_* → sensible local defaults. */
export function resolveLocalS3(): {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
} {
  const e = process.env;
  return {
    endpoint: e["S3_DEFAULT_ENDPOINT"] ?? e["MINIO_ENDPOINT"] ?? "http://localhost:9000",
    region: e["S3_DEFAULT_REGION"] ?? "us-east-1",
    bucket: e["S3_DEFAULT_BUCKET"] ?? "platform-data",
    accessKeyId: e["S3_ADMIN_ACCESS_KEY_ID"] ?? e["MINIO_ROOT_USER"] ?? "minioadmin",
    secretAccessKey: e["S3_ADMIN_SECRET_ACCESS_KEY"] ?? e["MINIO_ROOT_PASSWORD"] ?? "minioadmin",
  };
}
