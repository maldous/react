// Typed REST client for the Phase-6 account surface (ADR-0068 / ADR-ACT-0260).
// REST-over-BFF; own-user only for /api/me/*. Notifications readiness/test are operator.

import type {
  NotificationPreferencesResponse,
  NotificationReadinessResponse,
  TestNotificationRequest,
  TestNotificationResponse,
  UpdateNotificationPreferencesRequest,
  UpdateProfileRequest,
  UserProfile,
} from "@platform/contracts-admin";
import { adminGet, adminSend } from "../admin/admin-fetch";

export type {
  UserProfile,
  UpdateProfileRequest,
  NotificationPreferencesResponse,
  UpdateNotificationPreferencesRequest,
  NotificationReadinessResponse,
  TestNotificationRequest,
  TestNotificationResponse,
};

export function getMyProfile(): Promise<UserProfile> {
  return adminGet<UserProfile>("/api/me/profile");
}
export function updateMyProfile(input: UpdateProfileRequest): Promise<UserProfile> {
  return adminSend<UserProfile>("PATCH", "/api/me/profile", input);
}
export function getMyPreferences(): Promise<NotificationPreferencesResponse> {
  return adminGet<NotificationPreferencesResponse>("/api/me/notification-preferences");
}
export function updateMyPreferences(
  input: UpdateNotificationPreferencesRequest
): Promise<NotificationPreferencesResponse> {
  return adminSend<NotificationPreferencesResponse>(
    "PATCH",
    "/api/me/notification-preferences",
    input
  );
}
export function getNotificationReadiness(): Promise<NotificationReadinessResponse> {
  return adminGet<NotificationReadinessResponse>("/api/admin/notifications/readiness");
}
export function testNotification(
  tenantId: string,
  input: TestNotificationRequest
): Promise<TestNotificationResponse> {
  return adminSend<TestNotificationResponse>(
    "POST",
    `/api/admin/tenants/${encodeURIComponent(tenantId)}/notifications/test`,
    input
  );
}
