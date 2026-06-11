import type {
  EmailSenderSettings,
  UpdateEmailSenderSettings,
  EmailSenderReadinessResponse,
  TestEmailRequest,
  TestEmailResponse,
} from "@platform/contracts-admin";
import { adminGet, adminSend } from "../admin/admin-fetch";

export type { EmailSenderSettings, UpdateEmailSenderSettings, TestEmailResponse };

export function getEmailSender(): Promise<EmailSenderSettings> {
  return adminGet<EmailSenderSettings>("/api/org/email-sender");
}

export function updateEmailSender(input: UpdateEmailSenderSettings): Promise<EmailSenderSettings> {
  return adminSend<EmailSenderSettings>("PATCH", "/api/org/email-sender", input);
}

export function getEmailSenderReadiness(): Promise<EmailSenderReadinessResponse> {
  return adminGet<EmailSenderReadinessResponse>("/api/org/email-sender/readiness");
}

export function testEmailSender(input: TestEmailRequest): Promise<TestEmailResponse> {
  return adminSend<TestEmailResponse>("POST", "/api/org/email-sender/test", input);
}
