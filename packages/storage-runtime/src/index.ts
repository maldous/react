export const packageName = "@platform/storage-runtime";

export class StorageError extends Error {
  override readonly cause?: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "StorageError";
    this.cause = cause;
  }
}

export interface PutObjectCommand {
  key: string;
  body: Buffer | ReadableStream | string;
  contentType: string;
  metadata?: Record<string, string>;
}

export interface GetObjectResult {
  body: ReadableStream;
  contentType: string;
  metadata: Record<string, string>;
  size: number;
}

export interface PresignedUrlOptions {
  key: string;
  expiresInSeconds: number;
  contentType?: string;
}

export interface StorageListItem {
  key: string;
  size: number;
  lastModified: Date;
}

export interface ObjectStoragePort {
  put(command: PutObjectCommand): Promise<void>;
  get(key: string): Promise<GetObjectResult | null>;
  delete(key: string): Promise<void>;
  getPresignedUrl(options: PresignedUrlOptions): Promise<string>;
  list(prefix?: string): Promise<StorageListItem[]>;
}

export type StorageLifecycleState = "quarantined" | "clean" | "rejected";

export interface TenantScopedStoragePolicy {
  organisationId: string;
  quotaBeforeWrite: (input: { key: string; sizeBytes: number }) => Promise<void>;
  antivirusScan: (input: {
    key: string;
    body: Buffer | ReadableStream | string;
    contentType: string;
  }) => Promise<Extract<StorageLifecycleState, "clean" | "rejected">>;
  legalHoldDeletionBlock: (key: string) => Promise<void>;
  auditEvent: (event: {
    action:
      | "storage.object.put"
      | "storage.object.scan.clean"
      | "storage.object.scan.rejected"
      | "storage.object.download"
      | "storage.object.delete";
    organisationId: string;
    key: string;
    lifecycleState?: StorageLifecycleState;
  }) => Promise<void>;
  traceSpan: <T>(
    name: string,
    attributes: Record<string, string | number>,
    run: () => Promise<T>
  ) => Promise<T>;
  log: (level: "info" | "error", fields: Record<string, unknown>, message: string) => void;
  metric: (name: string, labels: Record<string, string>) => void;
}

function bodySizeBytes(body: Buffer | ReadableStream | string): number {
  if (Buffer.isBuffer(body)) return body.length;
  if (typeof body === "string") return Buffer.byteLength(body);
  return 0;
}

export function createTenantScopedObjectStoragePort(
  base: ObjectStoragePort,
  policy: TenantScopedStoragePolicy
): ObjectStoragePort {
  const tenantPrefix = `${policy.organisationId}/`;
  const lifecycle = new Map<string, StorageLifecycleState>();

  function assertTenantPrefixIsolation(key: string): void {
    if (!key.startsWith(tenantPrefix)) {
      throw new StorageError(
        `storage tenantPrefix isolation rejected key "${key}" outside "${tenantPrefix}"`
      );
    }
  }

  async function runWithTrace<T>(
    operation: string,
    key: string,
    run: () => Promise<T>
  ): Promise<T> {
    const log = { structured: policy.log };
    return policy.traceSpan(
      `storage.${operation}`,
      { operation, tenantPrefix, organisationId: policy.organisationId },
      async () => {
        try {
          const result = await run();
          policy.metric("storage_operation_total", { operation, outcome: "success" });
          log.structured(
            "info",
            { operation, key, organisationId: policy.organisationId },
            "storage.operation.complete"
          );
          return result;
        } catch (err) {
          policy.metric("storage_operation_total", { operation, outcome: "error" });
          log.structured(
            "error",
            { err, operation, key, organisationId: policy.organisationId },
            "storage.operation.failed"
          );
          throw err;
        }
      }
    );
  }

  return {
    async put(command) {
      assertTenantPrefixIsolation(command.key);
      const sizeBytes = bodySizeBytes(command.body);
      return runWithTrace("put", command.key, async () => {
        await policy.quotaBeforeWrite({ key: command.key, sizeBytes });
        await base.put({
          ...command,
          metadata: { ...command.metadata, lifecycleState: "quarantined" },
        });
        lifecycle.set(command.key, "quarantined");
        const verdict = await policy.antivirusScan({
          key: command.key,
          body: command.body,
          contentType: command.contentType,
        });
        lifecycle.set(command.key, verdict);
        await base.put({
          ...command,
          metadata: { ...command.metadata, lifecycleState: verdict },
        });
        await policy.auditEvent({
          action:
            verdict === "clean" ? "storage.object.scan.clean" : "storage.object.scan.rejected",
          organisationId: policy.organisationId,
          key: command.key,
          lifecycleState: verdict,
        });
      });
    },
    async get(key) {
      assertTenantPrefixIsolation(key);
      return runWithTrace("download", key, async () => {
        const state = lifecycle.get(key);
        if (state !== "clean") {
          throw new StorageError(
            `storage download blocked until clean AV scan; current lifecycle state is ${state ?? "missing"}`
          );
        }
        await policy.auditEvent({
          action: "storage.object.download",
          organisationId: policy.organisationId,
          key,
          lifecycleState: state,
        });
        return base.get(key);
      });
    },
    async delete(key) {
      assertTenantPrefixIsolation(key);
      return runWithTrace("delete", key, async () => {
        await policy.legalHoldDeletionBlock(key);
        await base.delete(key);
        lifecycle.delete(key);
        await policy.auditEvent({
          action: "storage.object.delete",
          organisationId: policy.organisationId,
          key,
        });
      });
    },
    async getPresignedUrl(options) {
      assertTenantPrefixIsolation(options.key);
      return runWithTrace("signedUrl", options.key, async () => {
        const state = lifecycle.get(options.key);
        if (state !== "clean") {
          throw new StorageError(
            `storage signedUrl policy blocked until clean scan; current lifecycle state is ${state ?? "missing"}; expiresIn=${options.expiresInSeconds}`
          );
        }
        return base.getPresignedUrl(options);
      });
    },
    async list(prefix = tenantPrefix) {
      assertTenantPrefixIsolation(prefix);
      return runWithTrace("list", prefix, () => base.list(prefix));
    },
  };
}

export function createInMemoryObjectStoragePort(): ObjectStoragePort {
  const store = new Map<
    string,
    { body: Buffer; contentType: string; metadata: Record<string, string> }
  >();
  return {
    async put({ key, body, contentType, metadata = {} }) {
      const buf = body instanceof Buffer ? body : Buffer.from(body as string);
      store.set(key, { body: buf, contentType, metadata });
    },
    async get(key) {
      const entry = store.get(key);
      if (!entry) return null;
      const buf = entry.body;
      return {
        body: new ReadableStream({
          start(c) {
            c.enqueue(buf);
            c.close();
          },
        }),
        contentType: entry.contentType,
        metadata: entry.metadata,
        size: buf.length,
      };
    },
    async delete(key) {
      store.delete(key);
    },
    async getPresignedUrl({ key, expiresInSeconds }) {
      return `memory://${key}?expires=${Date.now() + expiresInSeconds * 1000}`;
    },
    async list(prefix = "") {
      return [...store.entries()]
        .filter(([k]) => k.startsWith(prefix))
        .map(([k, v]) => ({ key: k, size: v.body.length, lastModified: new Date() }));
    },
  };
}
