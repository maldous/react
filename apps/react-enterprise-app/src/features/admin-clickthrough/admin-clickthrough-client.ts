import type {
  ClickthroughServicesResponse,
  ClickthroughServiceRow,
  ComposedProviderReadinessRow,
} from "@platform/contracts-admin";
import { adminGet } from "../admin/admin-fetch";

export type { ClickthroughServicesResponse, ClickthroughServiceRow, ComposedProviderReadinessRow };

/** GET /api/admin/clickthrough — composed Compose GUI services + readiness. No secret. */
export function getClickthroughServices(): Promise<ClickthroughServicesResponse> {
  return adminGet<ClickthroughServicesResponse>("/api/admin/clickthrough");
}
