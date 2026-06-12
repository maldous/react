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
} from "@platform/contracts-admin";
import { adminGet, adminSend } from "../admin/admin-fetch";

export type {
  WebhookSubscriptionListResponse,
  WebhookReadinessResponse,
  CreateWebhookSubscriptionResponse,
  WebhookSecretRotationResponse,
  WebhookTestResult,
  WebhookDeliveryListResponse,
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
