import { randomUUID } from "node:crypto";

export const packageName = "@platform/domain-core";

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

export type EntityId = string & { readonly __brand: unique symbol };

export function createId(): EntityId {
  return randomUUID() as EntityId;
}

export function isValidId(value: unknown): value is EntityId {
  return typeof value === "string" && value.length > 0;
}

// ---------------------------------------------------------------------------
// Timestamps
// ---------------------------------------------------------------------------

export function createTimestamp(): string {
  return new Date().toISOString();
}

export function fromISOString(iso: string): Date {
  return new Date(iso);
}

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

export interface PaginationInput {
  page: number;
  limit: number;
}

export interface PaginationMeta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

export interface SliceResult<T> {
  items: T[];
  meta: PaginationMeta;
}

export function createPaginationMeta(input: {
  total: number;
  page: number;
  limit: number;
}): PaginationMeta {
  const totalPages = Math.ceil(input.total / input.limit) || 1;
  return {
    total: input.total,
    page: input.page,
    limit: input.limit,
    totalPages,
    hasNextPage: input.page < totalPages,
    hasPreviousPage: input.page > 1,
  };
}

export function createSliceResult<T>(input: {
  items: T[];
  total: number;
  page: number;
  limit: number;
}): SliceResult<T> {
  return {
    items: input.items,
    meta: createPaginationMeta({ total: input.total, page: input.page, limit: input.limit }),
  };
}

// ---------------------------------------------------------------------------
// Domain events
// ---------------------------------------------------------------------------

export interface DomainEvent<T = Record<string, unknown>> {
  id: EntityId;
  type: string;
  payload: T;
  timestamp: string;
  aggregateId: EntityId;
  aggregateType: string;
}

export function createDomainEvent<T>(input: {
  type: string;
  payload: T;
  aggregateId: EntityId;
  aggregateType: string;
}): DomainEvent<T> {
  return {
    id: createId(),
    type: input.type,
    payload: input.payload,
    timestamp: createTimestamp(),
    aggregateId: input.aggregateId,
    aggregateType: input.aggregateType,
  };
}

// ---------------------------------------------------------------------------
// Sort
// ---------------------------------------------------------------------------

export type SortDirection = "asc" | "desc";
