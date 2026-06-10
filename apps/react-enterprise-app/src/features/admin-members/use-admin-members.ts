import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { InviteMemberRequest, UpdateMemberRoleRequest } from "@platform/contracts-admin";
import { listMembers, inviteMember, updateMemberRole, removeMember } from "./admin-members-client";

export const adminMembersQueryKey = ["admin", "members"] as const;

export function useMembers() {
  return useQuery({ queryKey: adminMembersQueryKey, queryFn: listMembers, retry: false });
}

function useInvalidateMembers() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: adminMembersQueryKey });
}

export function useInviteMember() {
  const invalidate = useInvalidateMembers();
  return useMutation({
    mutationFn: (input: InviteMemberRequest) => inviteMember(input),
    onSuccess: () => void invalidate(),
  });
}

export function useUpdateMemberRole() {
  const invalidate = useInvalidateMembers();
  return useMutation({
    mutationFn: ({ userId, input }: { userId: string; input: UpdateMemberRoleRequest }) =>
      updateMemberRole(userId, input),
    onSuccess: () => void invalidate(),
  });
}

export function useRemoveMember() {
  const invalidate = useInvalidateMembers();
  return useMutation({
    mutationFn: (userId: string) => removeMember(userId),
    onSuccess: () => void invalidate(),
  });
}
