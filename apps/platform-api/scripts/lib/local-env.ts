import { readFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Local-env loader for runtime proof scripts (ADR-ACT-0223; ADR-0072).
//
// Proof scripts run as plain `node` (no dotenv), so they don't see the local
// service credentials. ADR-0072: the source is the GENERATED runtime artifact
// .env/<stage>.env (from config/environments/<stage>.json) — a COMPLETE env
// (shared base + stage + secrets). Legacy .env / .env.<stage> regular files are a
// transition fallback. This loads those into process.env for keys that are NOT
// already set; it NEVER overrides an explicit process.env value, never reads the
// .env/ DIRECTORY as a file, and never prints values.
// ---------------------------------------------------------------------------

function isRegularFile(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isFile();
  } catch {
    return false;
  }
}

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
 * Load the generated runtime artifact `.env/<envName>.env` (ADR-0072), falling back
 * to legacy `.env` / `.env.<envName>` regular files, into process.env — only for keys
 * that are currently unset. Returns the list of files actually loaded. The `.env/`
 * directory is never read as a file.
 */
export function loadLocalEnv(envName = process.env["ENV"] ?? "dev"): string[] {
  const root = process.cwd();
  const loaded: string[] = [];
  // Generated artifact first (complete: shared base + stage + secrets), then legacy.
  for (const file of [join(".env", `${envName}.env`), ".env", `.env.${envName}`]) {
    const path = join(root, file);
    if (!isRegularFile(path)) continue;
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
