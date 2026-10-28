import { OrganizationRole } from "@uniffy/proto/common/v1/common_pb";

export function getRoleLabel(role: OrganizationRole): string {
  switch (role) {
    case OrganizationRole.OWNER:
      return "Owner";
    case OrganizationRole.ADMIN:
      return "Admin";
    case OrganizationRole.MEMBER:
      return "Member";
    default:
      return "Member";
  }
}

export function getRoleBadgeClasses(role: OrganizationRole): string {
  switch (role) {
    case OrganizationRole.OWNER:
      return "bg-gradient-to-r from-amber-100 to-amber-200 text-amber-700 dark:from-amber-950 dark:to-amber-900 dark:text-amber-300";
    case OrganizationRole.ADMIN:
      return "bg-gradient-to-r from-blue-100 to-blue-200 text-blue-700 dark:from-blue-950 dark:to-blue-900 dark:text-blue-300";
    default:
      return "bg-muted text-muted-foreground";
  }
}

const TOKEN_ROLES: Partial<Record<OrganizationRole, string>> = {
  [OrganizationRole.OWNER]: "OWNER",
  [OrganizationRole.ADMIN]: "ADMIN",
  [OrganizationRole.MEMBER]: "MEMBER",
};

/**
 * Whether the membership list names another role for the tab's organization than its token carries,
 * as after an ownership transfer or a role change made from another session.
 */
export function listedRoleDiffers(
  organizations: readonly { id: string; role: OrganizationRole }[],
  organizationId: string | null,
  tokenRole: string | null,
): boolean {
  if (!organizationId) return false;
  const listed = organizations.find((organization) => organization.id === organizationId);
  const listedRole = listed ? TOKEN_ROLES[listed.role] : undefined;
  return listedRole !== undefined && listedRole !== tokenRole;
}
