export const packageName = "@platform/storage-runtime";

export class StorageError extends Error {
  readonly cause?: unknown;
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

export function createInMemoryObjectStoragePort(): ObjectStoragePort {
  const store = new Map<
    string,
    { body: Buffer; contentType: string; metadata: Record<string, string> }
  >();
  return {
    async put({ key, body, contentType, metadata = {} }) {
      const buf =
        body instanceof Buffer
          ? body
          : Buffer.from(body as string);
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
