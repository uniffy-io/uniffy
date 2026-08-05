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

// BLOCKED sits above OWNER in the enum but denies everything, so it is checked
// explicitly rather than by comparing ordinals.
function atLeast(role: ContentRole | number, floor: ContentRole): boolean {
  if (role === ContentRole.BLOCKED) return false;
  return role >= floor;
}

export function roleCanEdit(role: ContentRole | number): boolean {
  return atLeast(role, ContentRole.EDITOR);
}

/** Members, access mode and field definitions all require ADMIN on the server. */
export function roleCanManage(role: ContentRole | number): boolean {
  return atLeast(role, ContentRole.ADMIN);
}
