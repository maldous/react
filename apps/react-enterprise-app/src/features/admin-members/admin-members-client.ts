import type {
  MemberListResponse,
  InviteMemberRequest,
  UpdateMemberRoleRequest,
  EditUsernameRequest,
  SetMemberStatusRequest,
  ResendInviteRequest,
  ExternalIdentityListResponse,
  TenantRoleValue,
  MembershipStatusValue,
} from "@platform/contracts-admin";
import { adminGet, adminSend } from "../admin/admin-fetch";

export type { MemberListResponse, TenantRoleValue, MembershipStatusValue };

export function listMembers(): Promise<MemberListResponse> {
  return adminGet<MemberListResponse>("/api/org/members");
}

export function inviteMember(input: InviteMemberRequest): Promise<unknown> {
  return adminSend("POST", "/api/org/members/invite", input);
}

export function updateMemberRole(userId: string, input: UpdateMemberRoleRequest): Promise<unknown> {
  return adminSend("PATCH", `/api/org/members/${encodeURIComponent(userId)}`, input);
}

export function removeMember(userId: string): Promise<unknown> {
  return adminSend("DELETE", `/api/org/members/${encodeURIComponent(userId)}`);
}

export function setMemberUsername(userId: string, input: EditUsernameRequest): Promise<unknown> {
  return adminSend("PATCH", `/api/org/members/${encodeURIComponent(userId)}/username`, input);
}

export function setMemberStatus(userId: string, input: SetMemberStatusRequest): Promise<unknown> {
  return adminSend("PATCH", `/api/org/members/${encodeURIComponent(userId)}/status`, input);
}

export function resendInvite(input: ResendInviteRequest): Promise<unknown> {
  return adminSend("POST", "/api/org/members/resend-invite", input);
}

export function listExternalIdentities(userId: string): Promise<ExternalIdentityListResponse> {
  return adminGet<ExternalIdentityListResponse>(
    `/api/org/members/${encodeURIComponent(userId)}/external-identities`
  );
}
