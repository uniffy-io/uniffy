import { AccessMode, ContentRole } from '@uniffy/proto/common/v1/common_pb';
import { Buildings, LockSimple, Users } from '@phosphor-icons/react';
import type { Icon } from '@phosphor-icons/react';

export const ROLE_ORDINAL: Record<number, number> = {
  [ContentRole.UNSPECIFIED]: -2,
  [ContentRole.BLOCKED]: -1,
  [ContentRole.VIEWER]: 1,
  [ContentRole.COMMENTER]: 2,
  [ContentRole.EDITOR]: 3,
  [ContentRole.ADMIN]: 4,
  [ContentRole.OWNER]: 5,
};

function ordinal(role: ContentRole | number | null | undefined): number {
  if (role === null || role === undefined) return -2;
  return ROLE_ORDINAL[role] ?? -2;
}

export const roleCanView = (role: ContentRole | number | null | undefined): boolean =>
  ordinal(role) >= ROLE_ORDINAL[ContentRole.VIEWER];

export const roleCanComment = (role: ContentRole | number | null | undefined): boolean =>
  ordinal(role) >= ROLE_ORDINAL[ContentRole.COMMENTER];

export const roleCanEdit = (role: ContentRole | number | null | undefined): boolean =>
  ordinal(role) >= ROLE_ORDINAL[ContentRole.EDITOR];

export const roleCanDelete = (role: ContentRole | number | null | undefined): boolean =>
  ordinal(role) >= ROLE_ORDINAL[ContentRole.ADMIN];

export const roleCanManage = (role: ContentRole | number | null | undefined): boolean =>
  ordinal(role) >= ROLE_ORDINAL[ContentRole.ADMIN];

export const roleCanTransfer = (role: ContentRole | number | null | undefined): boolean =>
  ordinal(role) >= ROLE_ORDINAL[ContentRole.OWNER];

export const roleLabel = (role: ContentRole | number | null | undefined): string => {
  switch (role) {
    case ContentRole.OWNER: return 'Owner';
    case ContentRole.ADMIN: return 'Admin';
    case ContentRole.EDITOR: return 'Editor';
    case ContentRole.COMMENTER: return 'Commenter';
    case ContentRole.VIEWER: return 'Viewer';
    case ContentRole.BLOCKED: return 'Blocked';
    default: return 'No access';
  }
};

export const accessModeLabel = (mode: AccessMode | number): string => {
  switch (mode) {
    case AccessMode.OWNER_ONLY: return 'Only owner';
    case AccessMode.EXPLICIT_MEMBERS: return 'Invited people';
    case AccessMode.OPEN_TO_ORG: return 'Everyone in org';
    default: return 'Unknown';
  }
};

export const accessModeDescription = (mode: AccessMode | number): string => {
  switch (mode) {
    case AccessMode.OWNER_ONLY:
      return 'Only you can see or edit this item.';
    case AccessMode.EXPLICIT_MEMBERS:
      return 'Only people and groups you invite can access this item.';
    case AccessMode.OPEN_TO_ORG:
      return 'Everyone in the organization inherits the baseline role you pick. Invited people can be elevated above or blocked below it.';
    default:
      return '';
  }
};

export const accessModeIcon = (mode: AccessMode | number): Icon => {
  switch (mode) {
    case AccessMode.OWNER_ONLY: return LockSimple;
    case AccessMode.EXPLICIT_MEMBERS: return Users;
    case AccessMode.OPEN_TO_ORG: return Buildings;
    default: return LockSimple;
  }
};

export type ContentBucket = 'personal' | 'shared' | 'organization';

export interface BucketInput {
  ownerId: string;
  accessMode: AccessMode | number;
  currentUserId: string;
}

export const bucketForContent = (params: BucketInput): ContentBucket => {
  if (params.accessMode === AccessMode.OPEN_TO_ORG) return 'organization';
  return params.ownerId === params.currentUserId ? 'personal' : 'shared';
};

export const isInPersonalBucket = (
  content: { ownerId: string; accessMode: AccessMode | number },
  currentUserId: string,
): boolean =>
  bucketForContent({
    ownerId: content.ownerId,
    accessMode: content.accessMode,
    currentUserId,
  }) === 'personal';

export const isInSharedBucket = (
  content: { ownerId: string; accessMode: AccessMode | number },
  currentUserId: string,
): boolean =>
  bucketForContent({
    ownerId: content.ownerId,
    accessMode: content.accessMode,
    currentUserId,
  }) === 'shared';

export const isInOrganizationBucket = (
  content: { accessMode: AccessMode | number },
): boolean => content.accessMode === AccessMode.OPEN_TO_ORG;

export const VALID_BASELINE_ROLES: readonly ContentRole[] = [
  ContentRole.VIEWER,
  ContentRole.COMMENTER,
  ContentRole.EDITOR,
  ContentRole.ADMIN,
];
