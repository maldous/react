import crypto from "node:crypto";
import zlib from "node:zlib";
import type { SecretStore } from "../ports/secret-store.ts";

const CURRENT_SCHEMA_VERSION = 1;
const TAR_BLOCK = 512;

export interface PortableTenantExportEntry {
  path: string;
  sha256: string;
  bytes: number;
  order: number;
  content: unknown;
}

export interface PortableTenantExportManifest {
  schemaVersion: 1;
  tenantId: string;
  exportedAt: string;
  sourceCommit: string;
  entries: Array<{ path: string; sha256: string; bytes: number; order: number }>;
  counts: { entries: number };
}

export interface PortableTenantSnapshot {
  tenantId: string;
  sourceCommit: string;
  exportedAt?: string;
  entries: Array<{ path: string; content: unknown; order: number }>;
}

export interface PortableTenantArchiveEnvelope {
  format: "platform-portable-tenant";
  version: 1;
  encryption: {
    alg: "AES-256-GCM";
    keyRef: string;
    iv: string;
    tag: string;
  };
  ciphertext: string;
}

export interface DataKeyStore {
  put(input: { organisationId: string; name: string; value: string; actorId: string }): Promise<{
    ref: string;
  }>;
  resolve(organisationId: string, ref: string): Promise<string | null>;
}

export interface DataPortabilityCryptoDeps {
  secretStore: Pick<SecretStore, "put" | "resolve"> | DataKeyStore;
  actorId: string;
}

export interface BuildPortableTenantExportResult {
  archive: Buffer;
  manifest: PortableTenantExportManifest;
  digest: string;
  keyRef: string;
}

function sha256(buf: Buffer): string {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function jsonBuffer(value: unknown): Buffer {
  return Buffer.from(JSON.stringify(value), "utf8");
}

function writeOctal(target: Buffer, offset: number, length: number, value: number): void {
  const text = value
    .toString(8)
    .padStart(length - 1, "0")
    .slice(0, length - 1);
  target.write(text, offset, length - 1, "ascii");
  target[offset + length - 1] = 0;
}

function tarHeader(path: string, size: number): Buffer {
  if (Buffer.byteLength(path) > 100) throw new Error(`tar path too long: ${path}`);
  const header = Buffer.alloc(TAR_BLOCK);
  header.write(path, 0, 100, "utf8");
  writeOctal(header, 100, 8, 0o644);
  writeOctal(header, 108, 8, 0);
  writeOctal(header, 116, 8, 0);
  writeOctal(header, 124, 12, size);
  writeOctal(header, 136, 12, Math.floor(Date.now() / 1000));
  header.fill(0x20, 148, 156);
  header.write("0", 156, 1, "ascii");
  header.write("ustar", 257, 6, "ascii");
  header.write("00", 263, 2, "ascii");
  let checksum = 0;
  for (const byte of header) checksum += byte;
  const checksumText = checksum.toString(8).padStart(6, "0");
  header.write(checksumText, 148, 6, "ascii");
  header[154] = 0;
  header[155] = 0x20;
  return header;
}

function buildTar(files: Array<{ path: string; body: Buffer }>): Buffer {
  const chunks: Buffer[] = [];
  for (const file of files) {
    chunks.push(tarHeader(file.path, file.body.length));
    chunks.push(file.body);
    const padding = (TAR_BLOCK - (file.body.length % TAR_BLOCK)) % TAR_BLOCK;
    if (padding > 0) chunks.push(Buffer.alloc(padding));
  }
  chunks.push(Buffer.alloc(TAR_BLOCK));
  chunks.push(Buffer.alloc(TAR_BLOCK));
  return Buffer.concat(chunks);
}

function parseOctal(buf: Buffer, offset: number, length: number): number {
  const octalText = buf.toString("ascii", offset, offset + length);
  const nul = octalText.indexOf("\0");
  const raw = octalText.slice(0, nul === -1 ? octalText.length : nul).trim();
  return raw ? Number.parseInt(raw, 8) : 0;
}

function parseTar(tar: Buffer): Map<string, Buffer> {
  const files = new Map<string, Buffer>();
  for (let offset = 0; offset + TAR_BLOCK <= tar.length; ) {
    const header = tar.subarray(offset, offset + TAR_BLOCK);
    if (header.every((b) => b === 0)) break;
    const pathSource = header.toString("utf8", 0, 100);
    const nul = pathSource.indexOf("\0");
    const path = pathSource.slice(0, nul === -1 ? pathSource.length : nul);
    const size = parseOctal(header, 124, 12);
    const bodyStart = offset + TAR_BLOCK;
    const bodyEnd = bodyStart + size;
    files.set(path, tar.subarray(bodyStart, bodyEnd));
    offset = bodyStart + size + ((TAR_BLOCK - (size % TAR_BLOCK)) % TAR_BLOCK);
  }
  return files;
}

function encryptTarGz(
  tarGz: Buffer,
  dataKey: Buffer,
  keyRef: string
): PortableTenantArchiveEnvelope {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", dataKey, iv);
  const ciphertext = Buffer.concat([cipher.update(tarGz), cipher.final()]);
  return {
    format: "platform-portable-tenant",
    version: 1,
    encryption: {
      alg: "AES-256-GCM",
      keyRef,
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
    },
    ciphertext: ciphertext.toString("base64"),
  };
}

async function decryptEnvelope(
  archive: Buffer,
  tenantId: string,
  secretStore: Pick<SecretStore, "resolve"> | DataKeyStore
): Promise<Buffer> {
  const envelope = JSON.parse(archive.toString("utf8")) as PortableTenantArchiveEnvelope;
  if (envelope.format !== "platform-portable-tenant" || envelope.version !== 1) {
    throw new Error("unsupported portable tenant archive");
  }
  const encodedKey = await secretStore.resolve(tenantId, envelope.encryption.keyRef);
  if (!encodedKey) throw new Error("portable tenant data key unavailable");
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    Buffer.from(encodedKey, "base64"),
    Buffer.from(envelope.encryption.iv, "base64")
  );
  decipher.setAuthTag(Buffer.from(envelope.encryption.tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, "base64")),
    decipher.final(),
  ]);
}

export async function buildPortableTenantExport(
  snapshot: PortableTenantSnapshot,
  deps: DataPortabilityCryptoDeps
): Promise<BuildPortableTenantExportResult> {
  const exportedAt = snapshot.exportedAt ?? new Date().toISOString();
  const entries = snapshot.entries
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((entry) => {
      const raw = jsonBuffer(entry.content);
      return {
        path: entry.path,
        sha256: sha256(raw),
        bytes: raw.length,
        order: entry.order,
        content: entry.content,
      } satisfies PortableTenantExportEntry;
    });
  const manifest: PortableTenantExportManifest = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    tenantId: snapshot.tenantId,
    exportedAt,
    sourceCommit: snapshot.sourceCommit,
    entries: entries.map(({ content: _content, ...m }) => m),
    counts: { entries: entries.length },
  };
  const files = [
    { path: "manifest.json", body: jsonBuffer(manifest) },
    ...entries.map((entry) => ({ path: entry.path, body: jsonBuffer(entry.content) })),
  ];
  const tarGz = zlib.gzipSync(buildTar(files));
  const dataKey = crypto.randomBytes(32);
  const key = await deps.secretStore.put({
    organisationId: snapshot.tenantId,
    name: `tenant-portability/${exportedAt}/data-key`,
    value: dataKey.toString("base64"),
    actorId: deps.actorId,
  });
  const envelope = encryptTarGz(tarGz, dataKey, key.ref);
  const archive = jsonBuffer(envelope);
  return { archive, manifest, digest: sha256(archive), keyRef: key.ref };
}

export async function verifyPortableTenantArchive(
  archive: Buffer,
  deps: { tenantId: string; secretStore: Pick<SecretStore, "resolve"> | DataKeyStore }
): Promise<{
  manifest: PortableTenantExportManifest;
  entries: Array<PortableTenantExportEntry>;
  digest: string;
}> {
  const tarGz = await decryptEnvelope(archive, deps.tenantId, deps.secretStore);
  const files = parseTar(zlib.gunzipSync(tarGz));
  const manifestRaw = files.get("manifest.json");
  if (!manifestRaw) throw new Error("manifest.json missing");
  const manifest = JSON.parse(manifestRaw.toString("utf8")) as PortableTenantExportManifest;
  if (manifest.schemaVersion > CURRENT_SCHEMA_VERSION) throw new Error("unsupported schemaVersion");
  if (manifest.tenantId !== deps.tenantId) throw new Error("tenantId mismatch");
  const entries = manifest.entries.map((m) => {
    const raw = files.get(m.path);
    if (!raw) throw new Error(`entry missing: ${m.path}`);
    if (raw.length !== m.bytes) throw new Error(`byte length mismatch for ${m.path}`);
    if (sha256(raw) !== m.sha256) throw new Error(`sha256 mismatch for ${m.path}`);
    return { ...m, content: JSON.parse(raw.toString("utf8")) };
  });
  return { manifest, entries, digest: sha256(archive) };
}

export interface PortableImportProgress {
  completedOrders: number[];
  failedOrder?: number;
  error?: string;
}

export interface PortableTenantImportApplier {
  beginGroup(order: number): Promise<void>;
  applyEntry(entry: PortableTenantExportEntry): Promise<void>;
  commitGroup(order: number): Promise<void>;
  rollbackGroup(order: number): Promise<void>;
  recordProgress(progress: PortableImportProgress): Promise<void>;
}

export async function applyPortableTenantImport(
  archive: Buffer,
  deps: {
    tenantId: string;
    secretStore: Pick<SecretStore, "resolve"> | DataKeyStore;
    applier: PortableTenantImportApplier;
    resume?: PortableImportProgress;
  }
): Promise<PortableImportProgress> {
  const verified = await verifyPortableTenantArchive(archive, deps);
  const completed = new Set(deps.resume?.completedOrders ?? []);
  const groups = new Map<number, PortableTenantExportEntry[]>();
  const sortedEntries = [...verified.entries].sort((a, b) => a.order - b.order);
  for (const entry of sortedEntries) {
    if (completed.has(entry.order)) continue;
    groups.set(entry.order, [...(groups.get(entry.order) ?? []), entry]);
  }

  for (const [order, entries] of groups) {
    await deps.applier.beginGroup(order);
    try {
      for (const entry of entries) await deps.applier.applyEntry(entry);
      await deps.applier.commitGroup(order);
      completed.add(order);
      await deps.applier.recordProgress({ completedOrders: [...completed].sort((a, b) => a - b) });
    } catch (err) {
      await deps.applier.rollbackGroup(order);
      const progress = {
        completedOrders: [...completed].sort((a, b) => a - b),
        failedOrder: order,
        error: err instanceof Error ? err.message : String(err),
      };
      await deps.applier.recordProgress(progress);
      return progress;
    }
  }
  const progress = { completedOrders: [...completed].sort((a, b) => a - b) };
  await deps.applier.recordProgress(progress);
  return progress;
}
