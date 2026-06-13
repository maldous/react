import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  TestNotificationRequest,
  UpdateNotificationPreferencesRequest,
  UpdateProfileRequest,
} from "@platform/contracts-admin";
import {
  getMyPreferences,
  getMyProfile,
  getNotificationReadiness,
  testNotification,
  updateMyPreferences,
  updateMyProfile,
} from "./admin-account-client";

export const myProfileKey = ["me", "profile"] as const;
export const myPreferencesKey = ["me", "notification-preferences"] as const;
export const notificationReadinessKey = ["admin", "notifications", "readiness"] as const;

export function useMyProfile() {
  return useQuery({ queryKey: myProfileKey, queryFn: getMyProfile, retry: false });
}
export function useMyPreferences() {
  return useQuery({ queryKey: myPreferencesKey, queryFn: getMyPreferences, retry: false });
}
export function useNotificationReadiness(enabled: boolean) {
  return useQuery({
    queryKey: notificationReadinessKey,
    queryFn: getNotificationReadiness,
    enabled,
    retry: false,
  });
}

export function useUpdateProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateProfileRequest) => updateMyProfile(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: myProfileKey });
      void queryClient.invalidateQueries({ queryKey: ["admin", "audit"] });
    },
  });
}

export function useUpdatePreferences() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateNotificationPreferencesRequest) => updateMyPreferences(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: myPreferencesKey });
      void queryClient.invalidateQueries({ queryKey: ["admin", "audit"] });
    },
  });
}

export function useTestNotification(tenantId: string) {
  return useMutation({
    mutationFn: (input: TestNotificationRequest) => testNotification(tenantId, input),
  });
}
