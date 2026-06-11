import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { UpdateEmailSenderSettings, TestEmailRequest } from "@platform/contracts-admin";
import { getEmailSender, updateEmailSender, testEmailSender } from "./admin-email-client";

export const emailSenderQueryKey = ["admin", "email", "sender"] as const;

export function useEmailSender() {
  return useQuery({ queryKey: emailSenderQueryKey, queryFn: getEmailSender, retry: false });
}

export function useUpdateEmailSender() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateEmailSenderSettings) => updateEmailSender(input),
    onSuccess: (data) => {
      queryClient.setQueryData(emailSenderQueryKey, data);
      void queryClient.invalidateQueries({ queryKey: ["admin", "audit"] });
    },
  });
}

export function useTestEmailSender() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: TestEmailRequest) => testEmailSender(input),
    onSuccess: () => {
      // A successful test marks the credential validated server-side → refresh
      // settings (readiness) and the audit panel.
      void queryClient.invalidateQueries({ queryKey: emailSenderQueryKey });
      void queryClient.invalidateQueries({ queryKey: ["admin", "audit"] });
    },
  });
}
