import type {
  MemberListResponse,
  InviteMemberRequest,
  UpdateMemberRoleRequest,
  TenantRoleValue,
} from "@platform/contracts-admin";
import { adminGet, adminSend } from "../admin/admin-fetch";

export type { MemberListResponse, TenantRoleValue };

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
