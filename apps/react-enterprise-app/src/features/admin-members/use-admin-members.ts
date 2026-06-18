import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  InviteMemberRequest,
  UpdateMemberRoleRequest,
  EditUsernameRequest,
  SetMemberStatusRequest,
  ResendInviteRequest,
} from "@platform/contracts-admin";
import {
  listMembers,
  inviteMember,
  updateMemberRole,
  removeMember,
  setMemberUsername,
  setMemberStatus,
  resendInvite,
  listExternalIdentities,
} from "./admin-members-client";

export const adminMembersQueryKey = ["admin", "members"] as const;

export function useMembers() {
  return useQuery({ queryKey: adminMembersQueryKey, queryFn: listMembers, retry: false });
}

function useInvalidateMembers() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: adminMembersQueryKey });
    // Refresh any open contextual audit panels (ADR-0040).
    void queryClient.invalidateQueries({ queryKey: ["admin", "audit"] });
  };
}

export function useInviteMember() {
  const invalidate = useInvalidateMembers();
  return useMutation({
    mutationFn: (input: InviteMemberRequest) => inviteMember(input),
    onSuccess: () => invalidate(),
  });
}

export function useUpdateMemberRole() {
  const invalidate = useInvalidateMembers();
  return useMutation({
    mutationFn: ({ userId, input }: { userId: string; input: UpdateMemberRoleRequest }) =>
      updateMemberRole(userId, input),
    onSuccess: () => invalidate(),
  });
}

export function useRemoveMember() {
  const invalidate = useInvalidateMembers();
  return useMutation({
    mutationFn: (userId: string) => removeMember(userId),
    onSuccess: () => invalidate(),
  });
}

export function useEditUsername() {
  const invalidate = useInvalidateMembers();
  return useMutation({
    mutationFn: ({ userId, input }: { userId: string; input: EditUsernameRequest }) =>
      setMemberUsername(userId, input),
    onSuccess: () => invalidate(),
  });
}

export function useSetMemberStatus() {
  const invalidate = useInvalidateMembers();
  return useMutation({
    mutationFn: ({ userId, input }: { userId: string; input: SetMemberStatusRequest }) =>
      setMemberStatus(userId, input),
    onSuccess: () => invalidate(),
  });
}

export function useResendInvite() {
  return useMutation({
    mutationFn: (input: ResendInviteRequest) => resendInvite(input),
  });
}

export function useExternalIdentities(userId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["admin", "members", userId, "external-identities"] as const,
    queryFn: () => listExternalIdentities(userId),
    enabled,
    retry: false,
  });
}
