import type {
  WebhookSubscriptionListResponse,
  WebhookReadinessResponse,
  CreateWebhookSubscriptionRequest,
  CreateWebhookSubscriptionResponse,
  UpdateWebhookSubscriptionRequest,
  WebhookSubscriptionSummary,
  WebhookSecretRotationResponse,
  WebhookTestResult,
  WebhookDeliveryListResponse,
  WebhookSubscriptionMetrics,
  WebhookRedriveResponse,
} from "@platform/contracts-admin";
import { adminGet, adminSend } from "../admin/admin-fetch";

export type {
  WebhookSubscriptionListResponse,
  WebhookReadinessResponse,
  CreateWebhookSubscriptionResponse,
  WebhookSecretRotationResponse,
  WebhookTestResult,
  WebhookDeliveryListResponse,
  WebhookSubscriptionMetrics,
  WebhookRedriveResponse,
};

export function listWebhooks(): Promise<WebhookSubscriptionListResponse> {
  return adminGet<WebhookSubscriptionListResponse>("/api/org/webhooks");
}

export function getWebhooksReadiness(): Promise<WebhookReadinessResponse> {
  return adminGet<WebhookReadinessResponse>("/api/org/webhooks/readiness");
}

export function createWebhook(
  input: CreateWebhookSubscriptionRequest
): Promise<CreateWebhookSubscriptionResponse> {
  return adminSend<CreateWebhookSubscriptionResponse>("POST", "/api/org/webhooks", input);
}

export function updateWebhook(
  id: string,
  input: UpdateWebhookSubscriptionRequest
): Promise<WebhookSubscriptionSummary> {
  return adminSend<WebhookSubscriptionSummary>(
    "PATCH",
    `/api/org/webhooks/${encodeURIComponent(id)}`,
    input
  );
}

export function deleteWebhook(id: string): Promise<void> {
  return adminSend<void>("DELETE", `/api/org/webhooks/${encodeURIComponent(id)}`);
}

export function rotateWebhookSecret(id: string): Promise<WebhookSecretRotationResponse> {
  return adminSend<WebhookSecretRotationResponse>(
    "POST",
    `/api/org/webhooks/${encodeURIComponent(id)}/rotate-secret`
  );
}

export function testWebhook(id: string): Promise<WebhookTestResult> {
  return adminSend<WebhookTestResult>("POST", `/api/org/webhooks/${encodeURIComponent(id)}/test`);
}

export function listWebhookDeliveries(id: string): Promise<WebhookDeliveryListResponse> {
  return adminGet<WebhookDeliveryListResponse>(
    `/api/org/webhooks/${encodeURIComponent(id)}/deliveries`
  );
}

export function getWebhookMetrics(id: string): Promise<WebhookSubscriptionMetrics> {
  return adminGet<WebhookSubscriptionMetrics>(
    `/api/org/webhooks/${encodeURIComponent(id)}/metrics`
  );
}

export function redriveWebhookDelivery(
  id: string,
  deliveryId: string
): Promise<WebhookRedriveResponse> {
  return adminSend<WebhookRedriveResponse>(
    "POST",
    `/api/org/webhooks/${encodeURIComponent(id)}/deliveries/${encodeURIComponent(deliveryId)}/redrive`
  );
}

export function redriveDeadWebhooks(id: string): Promise<WebhookRedriveResponse> {
  return adminSend<WebhookRedriveResponse>(
    "POST",
    `/api/org/webhooks/${encodeURIComponent(id)}/redrive-dead`
  );
}
