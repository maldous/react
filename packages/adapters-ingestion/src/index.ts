import { randomUUID } from "node:crypto";
import {
  IngestionPayloadSchema,
  NormalizedRecordSchema,
  type IngestionPayload,
  type NormalizedRecord,
  type IngestionResult,
} from "@platform/contracts-ingestion";

export const packageName = "@platform/adapters-ingestion";

export type NormalizerFn = (payload: IngestionPayload) => NormalizedRecord;

export interface HttpIngestionConfig {
  validate?: boolean;
  normalizer?: NormalizerFn;
}

const defaultNormalizer: NormalizerFn = (payload) => ({
  id: randomUUID(),
  source: payload.source,
  sourceId: payload.sourceId,
  receivedAt: payload.receivedAt,
  normalizedAt: new Date().toISOString(),
  data: payload.data,
  version: 1,
});

export class HttpIngestionAdapter {
  private readonly validate: boolean;
  private readonly normalizer: NormalizerFn;

  constructor(config: HttpIngestionConfig = {}) {
    this.validate = config.validate ?? true;
    this.normalizer = config.normalizer ?? defaultNormalizer;
  }

  async ingest(raw: unknown): Promise<IngestionResult> {
    if (this.validate) {
      const parsed = IngestionPayloadSchema.safeParse(raw);
      if (!parsed.success) {
        return { recordId: "", status: "rejected", reason: parsed.error.issues[0]?.message };
      }
      const normalized = this.normalizer(parsed.data);
      const normValidated = NormalizedRecordSchema.safeParse(normalized);
      if (!normValidated.success) {
        return {
          recordId: "",
          status: "rejected",
          reason: "Normalization produced invalid record",
        };
      }
      return { recordId: normalized.id, status: "accepted" };
    }
    const payload = raw as IngestionPayload;
    const normalized = this.normalizer(payload);
    return { recordId: normalized.id, status: "accepted" };
  }
}
