import { AccessMode, ContentRole } from "@uniffy/proto/common/v1/common_pb";

export type ContentBucket = "personal" | "shared" | "organization";

/** Mirrors the web sidebar's buckets so the same content sorts the same way. */
export function bucketForContent(params: {
  ownerId: string;
  accessMode: AccessMode | number;
  currentUserId: string;
}): ContentBucket {
  if (params.accessMode === AccessMode.OPEN_TO_ORG) return "organization";
  return params.ownerId === params.currentUserId ? "personal" : "shared";
}

/**
 * BLOCKED sits above OWNER in the proto enum but denies everything, so the
 * ordering is declared here rather than read off the enum's numeric values.
 * Mirrors the web app's `shared/utils/contentRoles.ts`; both are advisory - the
 * backend is the gate.
 */
const ROLE_ORDINAL: Record<number, number> = {
  [ContentRole.UNSPECIFIED]: -2,
  [ContentRole.BLOCKED]: -1,
  [ContentRole.VIEWER]: 1,
  [ContentRole.COMMENTER]: 2,
  [ContentRole.EDITOR]: 3,
  [ContentRole.ADMIN]: 4,
  [ContentRole.OWNER]: 5,
};

type Role = ContentRole | number | null | undefined;

function ordinal(role: Role): number {
  if (role === null || role === undefined) return -2;
  return ROLE_ORDINAL[role] ?? -2;
}

export function roleCanView(role: Role): boolean {
  return ordinal(role) >= ROLE_ORDINAL[ContentRole.VIEWER];
}

export function roleCanComment(role: Role): boolean {
  return ordinal(role) >= ROLE_ORDINAL[ContentRole.COMMENTER];
}

export function roleCanEdit(role: Role): boolean {
  return ordinal(role) >= ROLE_ORDINAL[ContentRole.EDITOR];
}

export function roleCanDelete(role: Role): boolean {
  return ordinal(role) >= ROLE_ORDINAL[ContentRole.ADMIN];
}

/** Members, access mode and field definitions all require ADMIN on the server. */
export function roleCanManage(role: Role): boolean {
  return ordinal(role) >= ROLE_ORDINAL[ContentRole.ADMIN];
}

export function roleCanTransfer(role: Role): boolean {
  return ordinal(role) >= ROLE_ORDINAL[ContentRole.OWNER];
}

export function roleLabel(role: Role): string {
  switch (role) {
    case ContentRole.OWNER:
      return "Owner";
    case ContentRole.ADMIN:
      return "Admin";
    case ContentRole.EDITOR:
      return "Editor";
    case ContentRole.COMMENTER:
      return "Commenter";
    case ContentRole.VIEWER:
      return "Viewer";
    case ContentRole.BLOCKED:
      return "Blocked";
    default:
      return "No access";
  }
}
