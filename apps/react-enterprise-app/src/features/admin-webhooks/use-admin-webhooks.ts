import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CreateWebhookSubscriptionRequest,
  UpdateWebhookSubscriptionRequest,
} from "@platform/contracts-admin";
import {
  listWebhooks,
  getWebhooksReadiness,
  createWebhook,
  updateWebhook,
  deleteWebhook,
  rotateWebhookSecret,
  testWebhook,
  listWebhookDeliveries,
  getWebhookMetrics,
  redriveWebhookDelivery,
  redriveDeadWebhooks,
} from "./admin-webhooks-client";

export const webhooksQueryKey = ["admin", "webhooks"] as const;
export const webhooksReadinessQueryKey = ["admin", "webhooks", "readiness"] as const;

export function useWebhooks() {
  return useQuery({ queryKey: webhooksQueryKey, queryFn: listWebhooks, retry: false });
}

export function useWebhooksReadiness() {
  return useQuery({
    queryKey: webhooksReadinessQueryKey,
    queryFn: getWebhooksReadiness,
    retry: false,
  });
}

function useInvalidateWebhooks() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: webhooksQueryKey });
    void queryClient.invalidateQueries({ queryKey: webhooksReadinessQueryKey });
    void queryClient.invalidateQueries({ queryKey: ["admin", "audit"] });
  };
}

export function useCreateWebhook() {
  const invalidate = useInvalidateWebhooks();
  return useMutation({
    mutationFn: (input: CreateWebhookSubscriptionRequest) => createWebhook(input),
    onSuccess: invalidate,
  });
}

export function useUpdateWebhook() {
  const invalidate = useInvalidateWebhooks();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateWebhookSubscriptionRequest }) =>
      updateWebhook(id, input),
    onSuccess: invalidate,
  });
}

export function useDeleteWebhook() {
  const invalidate = useInvalidateWebhooks();
  return useMutation({
    mutationFn: (id: string) => deleteWebhook(id),
    onSuccess: invalidate,
  });
}

export function useRotateSecret() {
  const invalidate = useInvalidateWebhooks();
  return useMutation({
    mutationFn: (id: string) => rotateWebhookSecret(id),
    onSuccess: invalidate,
  });
}

export function useTestWebhook() {
  return useMutation({
    mutationFn: (id: string) => testWebhook(id),
  });
}

export function useWebhookDeliveries(id: string) {
  return useQuery({
    queryKey: ["admin", "webhooks", id, "deliveries"],
    queryFn: () => listWebhookDeliveries(id),
    retry: false,
  });
}

export function useWebhookMetrics(id: string) {
  return useQuery({
    queryKey: ["admin", "webhooks", id, "metrics"],
    queryFn: () => getWebhookMetrics(id),
    retry: false,
  });
}

function useInvalidateAfterRedrive(id: string) {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: ["admin", "webhooks", id, "metrics"] });
    void queryClient.invalidateQueries({ queryKey: ["admin", "webhooks", id, "deliveries"] });
    void queryClient.invalidateQueries({ queryKey: webhooksQueryKey });
    void queryClient.invalidateQueries({ queryKey: webhooksReadinessQueryKey });
    void queryClient.invalidateQueries({ queryKey: ["admin", "audit"] });
  };
}

export function useRedriveDelivery(subscriptionId: string) {
  const invalidate = useInvalidateAfterRedrive(subscriptionId);
  return useMutation({
    mutationFn: (deliveryId: string) => redriveWebhookDelivery(subscriptionId, deliveryId),
    onSuccess: invalidate,
  });
}

export function useRedriveDead(subscriptionId: string) {
  const invalidate = useInvalidateAfterRedrive(subscriptionId);
  return useMutation({
    mutationFn: () => redriveDeadWebhooks(subscriptionId),
    onSuccess: invalidate,
  });
}
