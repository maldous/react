import { z } from "zod";

export const packageName = "@platform/contracts-ingestion";

export const IngestionSourceSchema = z.enum(["webhook", "api", "stream", "batch"]);
export type IngestionSource = z.infer<typeof IngestionSourceSchema>;

export const IngestionPayloadSchema = z.object({
  source: IngestionSourceSchema,
  sourceId: z.string(),
  receivedAt: z.string().datetime(),
  data: z.record(z.unknown()),
  headers: z.record(z.string()).optional(),
  signature: z.string().optional(),
});

export const NormalizedRecordSchema = z.object({
  id: z.string(),
  source: IngestionSourceSchema,
  sourceId: z.string(),
  receivedAt: z.string().datetime(),
  normalizedAt: z.string().datetime(),
  data: z.record(z.unknown()),
  schema: z.string().optional(),
  version: z.number().default(1),
});

export type IngestionPayload = z.infer<typeof IngestionPayloadSchema>;
export type NormalizedRecord = z.infer<typeof NormalizedRecordSchema>;

export interface IngestionResult {
  recordId: string;
  status: "accepted" | "rejected";
  reason?: string;
}
