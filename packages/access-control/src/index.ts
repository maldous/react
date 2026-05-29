export const packageName = "@platform/access-control";

export interface PolicyActor {
  roles: string[];
}

export interface Policy {
  can(actor: PolicyActor, action: string, resource?: string): boolean;
}

export type RolePermissionMap = Record<string, string[]>;

export function createRbacPolicy(rolePermissions: RolePermissionMap): Policy {
  return {
    can(actor, action) {
      return actor.roles.some((role) => rolePermissions[role]?.includes(action) ?? false);
    },
  };
}

export function createAllowAllPolicy(): Policy {
  return { can: () => true };
}

export function createDenyAllPolicy(): Policy {
  return { can: () => false };
}

export function combineAny(...policies: Policy[]): Policy {
  return {
    can(actor, action, resource) {
      return policies.some((p) => p.can(actor, action, resource));
    },
  };
}

export function combineAll(...policies: Policy[]): Policy {
  return {
    can(actor, action, resource) {
      return policies.every((p) => p.can(actor, action, resource));
    },
  };
}
