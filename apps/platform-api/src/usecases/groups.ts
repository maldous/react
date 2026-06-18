import { AuditAction, createAuditEvent, type AuditEventPort } from "@platform/audit-events";
import type { KeycloakGroup } from "@platform/authorisation-runtime";

// ---------------------------------------------------------------------------
// Group management usecase (ADR-ACT-0143 Slice 2)
//
// Groups live in Keycloak only — there is no Postgres table. The usecase
// depends on an injected GroupsAdapterPort so tests use in-memory fakes
// without fetch mocks. The route resolves the tenant credential, constructs
// the real KeycloakRealmAdminAdapter, and passes it here as the adapter.
//
// Mutation ordering (ADR-ACT-0154 audit-first):
//   1. Validate name
//   2. Pre-condition check (get/list groups — pure reads)
//   3. If conflict/not_found/protected → return result kind, NO audit
//   4. Emit audit event — if this throws, mutation does not run
//   5. Execute Keycloak mutation
//
// This avoids the misleading-audit-on-conflict bug (advisor Trap 1): Keycloak
// returns 409 on duplicate sibling group names, but relying on that to detect
// conflicts would fire a GroupCreated audit event before the 409 is seen.
// Instead, we list groups and check for name collisions before auditing.
//
// Error handling: result types, never throws. The pipeline catches unhandled
// errors as 500; typed AppErrors from usecases become 500 there too.
// ---------------------------------------------------------------------------

/** Minimal adapter surface the group usecases need. */
export interface GroupsAdapterPort {
  listGroups(): Promise<KeycloakGroup[]>;
  getGroup(groupId: string): Promise<KeycloakGroup | null>;
  createGroup(name: string): Promise<string>; // returns new group ID
  updateGroup(groupId: string, name: string, existing: KeycloakGroup): Promise<void>;
  deleteGroup(groupId: string): Promise<void>;
}

export interface GroupsDeps {
  groups: GroupsAdapterPort;
  audit: AuditEventPort;
}

// ---------------------------------------------------------------------------
// Reserved group names — must not be created or renamed to these names.
// These are Keycloak built-in groups / roles that should not be shadowed.
// Comparison is case-insensitive.
// ---------------------------------------------------------------------------
const RESERVED_GROUP_NAMES = new Set([
  "system",
  "admin",
  "platform",
  "realm-management",
  "offline_access",
  "uma_authorization",
]);

function isReserved(name: string): boolean {
  return RESERVED_GROUP_NAMES.has(name.toLowerCase());
}

// ---------------------------------------------------------------------------
// Group name validation — applied before every mutation.
// ---------------------------------------------------------------------------
function validateGroupName(name: string): { ok: true } | { ok: false; message: string } {
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, message: "group name is required" };
  if (trimmed.length > 64)
    return { ok: false, message: "group name must not exceed 64 characters" };
  // Reject path separators and control characters (ASCII 0-31, 127, slash, backslash).
  // Control chars are checked by code point (not a control-char regex range) to keep
  // the intent explicit and avoid an error-prone literal-control-char pattern (S6324).
  const hasControlChar = [...trimmed].some((ch) => {
    const code = ch.charCodeAt(0);
    return code <= 0x1f || code === 0x7f;
  });
  if (/[/\\]/.test(trimmed) || hasControlChar) {
    return {
      ok: false,
      message:
        "group name contains invalid characters (path separators or control characters are not allowed)",
    };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// listGroups — read-only, no audit required
// ---------------------------------------------------------------------------

export async function listOrgGroups(adapter: GroupsAdapterPort): Promise<KeycloakGroup[]> {
  return adapter.listGroups();
}

// ---------------------------------------------------------------------------
// createGroup
// ---------------------------------------------------------------------------

export type CreateGroupResult =
  | { kind: "ok"; groupId: string; groupName: string }
  | { kind: "invalid_name"; message: string }
  | { kind: "conflict" }; // another group with this name already exists

export async function createOrgGroup(
  input: {
    rawName: unknown;
    organisationId: string;
    actorId: string;
    actorRoles: string[];
  },
  deps: GroupsDeps
): Promise<CreateGroupResult> {
  if (typeof input.rawName !== "string") {
    return { kind: "invalid_name", message: "name must be a string" };
  }
  const name = input.rawName.trim();
  const validation = validateGroupName(name);
  if (!validation.ok) return { kind: "invalid_name", message: validation.message };

  // Pre-audit duplicate check — prevents misleading GroupCreated audit on conflict
  const existing = await deps.groups.listGroups();
  const duplicate = existing.find((g) => g.name.toLowerCase() === name.toLowerCase());
  if (duplicate) return { kind: "conflict" };

  await deps.audit.emit(
    createAuditEvent({
      actorId: input.actorId,
      actorRoles: input.actorRoles,
      tenantId: input.organisationId,
      action: AuditAction.GroupCreated,
      resource: "organisation:groups",
      resourceId: name, // ID doesn't exist yet; name is the stable identifier pre-create
      metadata: { groupName: name },
    })
  );

  const groupId = await deps.groups.createGroup(name);
  return { kind: "ok", groupId, groupName: name };
}

// ---------------------------------------------------------------------------
// updateGroup
// ---------------------------------------------------------------------------

export type UpdateGroupResult =
  | { kind: "ok" }
  | { kind: "invalid_name"; message: string }
  | { kind: "not_found" }
  | { kind: "conflict" }; // another (different) group already has this name

export async function updateOrgGroup(
  input: {
    groupId: string;
    rawName: unknown;
    organisationId: string;
    actorId: string;
    actorRoles: string[];
  },
  deps: GroupsDeps
): Promise<UpdateGroupResult> {
  if (typeof input.rawName !== "string") {
    return { kind: "invalid_name", message: "name must be a string" };
  }
  const name = input.rawName.trim();
  const validation = validateGroupName(name);
  if (!validation.ok) return { kind: "invalid_name", message: validation.message };

  // Fetch the group to confirm it exists and to get its full representation for the merge PUT
  const target = await deps.groups.getGroup(input.groupId);
  if (!target) return { kind: "not_found" };

  // Pre-audit conflict check — exclude self (same ID) to allow same-name no-op renames
  const allGroups = await deps.groups.listGroups();
  const conflict = allGroups.find(
    (g) => g.name.toLowerCase() === name.toLowerCase() && g.id !== input.groupId
  );
  if (conflict) return { kind: "conflict" };

  await deps.audit.emit(
    createAuditEvent({
      actorId: input.actorId,
      actorRoles: input.actorRoles,
      tenantId: input.organisationId,
      action: AuditAction.GroupUpdated,
      resource: "organisation:groups",
      resourceId: input.groupId,
      metadata: { groupId: input.groupId, oldName: target.name, newName: name },
    })
  );

  await deps.groups.updateGroup(input.groupId, name, target);
  return { kind: "ok" };
}

// ---------------------------------------------------------------------------
// deleteGroup
// ---------------------------------------------------------------------------

export type DeleteGroupResult = { kind: "ok" } | { kind: "not_found" } | { kind: "protected" }; // reserved name — cannot be deleted

export async function deleteOrgGroup(
  input: {
    groupId: string;
    organisationId: string;
    actorId: string;
    actorRoles: string[];
  },
  deps: GroupsDeps
): Promise<DeleteGroupResult> {
  const target = await deps.groups.getGroup(input.groupId);
  if (!target) return { kind: "not_found" };

  // Block deletion of groups whose names match Keycloak built-in / reserved names
  if (isReserved(target.name)) return { kind: "protected" };

  await deps.audit.emit(
    createAuditEvent({
      actorId: input.actorId,
      actorRoles: input.actorRoles,
      tenantId: input.organisationId,
      action: AuditAction.GroupDeleted,
      resource: "organisation:groups",
      resourceId: input.groupId,
      metadata: { groupId: input.groupId, groupName: target.name },
    })
  );

  await deps.groups.deleteGroup(input.groupId);
  return { kind: "ok" };
}
