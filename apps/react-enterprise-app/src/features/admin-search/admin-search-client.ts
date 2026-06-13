// Typed REST client for the Phase-4 tenant search surface (ADR-0060 / ADR-ACT-0258).
// REST-over-BFF; server-authoritative. Search runs server-side; React renders hits.
// No secrets cross this boundary.

import type {
  ReindexResponse,
  SearchReadinessResponse,
  SearchRequest,
  SearchResponse,
} from "@platform/contracts-admin";
import { adminGet, adminSend } from "../admin/admin-fetch";

export type { SearchRequest, SearchResponse, SearchReadinessResponse, ReindexResponse };

export function runSearch(input: SearchRequest): Promise<SearchResponse> {
  return adminSend<SearchResponse>("POST", "/api/org/search", input);
}
export function getSearchReadiness(): Promise<SearchReadinessResponse> {
  return adminGet<SearchReadinessResponse>("/api/admin/search/readiness");
}
export function reindexTenantSearch(tenantId: string): Promise<ReindexResponse> {
  return adminSend<ReindexResponse>("POST", "/api/admin/search/reindex", { tenantId });
}
