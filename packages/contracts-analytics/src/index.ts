import { z } from "zod";

export const packageName = "@platform/contracts-analytics";

const BaseEventSchema = z.object({
  userId: z.string().nullable(),
  anonymousId: z.string().nullable(),
  timestamp: z.string().datetime(),
  sessionId: z.string().optional(),
  tenantId: z.string().optional(),
});

export const PageViewEventSchema = BaseEventSchema.extend({
  type: z.literal("page_view"),
  page: z.string(),
  referrer: z.string().nullable(),
  title: z.string().optional(),
  search: z.string().optional(),
});

export const TrackEventSchema = BaseEventSchema.extend({
  type: z.literal("track"),
  event: z.string(),
  properties: z.record(z.unknown()).default({}),
});

export const IdentifyEventSchema = BaseEventSchema.extend({
  type: z.literal("identify"),
  traits: z.record(z.unknown()).default({}),
});

export const AnalyticsEventSchema = z.discriminatedUnion("type", [
  PageViewEventSchema,
  TrackEventSchema,
  IdentifyEventSchema,
]);

export type PageViewEvent = z.infer<typeof PageViewEventSchema>;
export type TrackEvent = z.infer<typeof TrackEventSchema>;
export type IdentifyEvent = z.infer<typeof IdentifyEventSchema>;
export type AnalyticsEvent = z.infer<typeof AnalyticsEventSchema>;

export interface AnalyticsQueryFilter {
  tenantId?: string;
  userId?: string;
  eventType?: string;
  from?: Date;
  to?: Date;
  limit?: number;
}
