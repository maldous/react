import crypto from "node:crypto";
import zlib from "node:zlib";

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

export function buildPortableTenantExport(snapshot: PortableTenantSnapshot): {
  archive: Buffer;
  manifest: PortableTenantExportManifest;
  digest: string;
} {
  const exportedAt = snapshot.exportedAt ?? new Date().toISOString();
  const entries = snapshot.entries
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((entry) => {
      const raw = Buffer.from(JSON.stringify(entry.content));
      return {
        path: entry.path,
        sha256: crypto.createHash("sha256").update(raw).digest("hex"),
        bytes: raw.length,
        order: entry.order,
        content: entry.content,
      } satisfies PortableTenantExportEntry;
    });
  const manifest: PortableTenantExportManifest = {
    schemaVersion: 1,
    tenantId: snapshot.tenantId,
    exportedAt,
    sourceCommit: snapshot.sourceCommit,
    entries: entries.map(({ content: _content, ...m }) => m),
    counts: { entries: entries.length },
  };
  const payload = Buffer.from(JSON.stringify({ manifest, entries }), "utf8");
  const archive = zlib.gzipSync(payload);
  const digest = crypto.createHash("sha256").update(archive).digest("hex");
  return { archive, manifest, digest };
}

export function verifyPortableTenantArchive(archive: Buffer): PortableTenantExportManifest {
  const parsed = JSON.parse(zlib.gunzipSync(archive).toString("utf8")) as {
    manifest: PortableTenantExportManifest;
    entries: Array<PortableTenantExportEntry>;
  };
  for (const entry of parsed.entries) {
    const raw = Buffer.from(JSON.stringify(entry.content));
    const digest = crypto.createHash("sha256").update(raw).digest("hex");
    if (digest !== entry.sha256) {
      throw new Error(`sha256 mismatch for ${entry.path}`);
    }
  }
  return parsed.manifest;
}
