import type { ConfigListResponse } from "@platform/contracts-admin";
import { adminGet, adminSend } from "../admin/admin-fetch";

export type { ConfigListResponse };

export function listConfig(category?: string): Promise<ConfigListResponse> {
  const q = category ? `?category=${encodeURIComponent(category)}` : "";
  return adminGet<ConfigListResponse>(`/api/org/config${q}`);
}

export function setConfigValue(key: string, value: unknown): Promise<unknown> {
  return adminSend("PATCH", `/api/org/config/${encodeURIComponent(key)}`, { value });
}

export function clearConfigValue(key: string): Promise<unknown> {
  return adminSend("DELETE", `/api/org/config/${encodeURIComponent(key)}`);
}
