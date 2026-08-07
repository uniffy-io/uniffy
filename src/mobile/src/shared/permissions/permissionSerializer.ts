import type {
  ContentMember as ProtoMember,
  ContentAccessPolicy,
} from "@uniffy/proto/permissions/v1/permissions_pb";
import { ContentRole, AccessMode, SubjectType } from "@uniffy/proto/common/v1/common_pb";

export type RoleName = "VIEWER" | "COMMENTER" | "EDITOR" | "ADMIN" | "OWNER" | "BLOCKED";
export type AccessModeName = "OWNER_ONLY" | "EXPLICIT_MEMBERS" | "OPEN_TO_ORG";
export type SubjectKind = "USER" | "GROUP";

export interface SerializedMember {
  subjectType: SubjectKind;
  subjectId: string;
  role: RoleName;
}

export interface SerializedPolicy {
  ownerId: string;
  accessMode: AccessModeName;
  effectiveAccessMode: AccessModeName;
  baselineRole: RoleName | null;
  callerRole: RoleName | null;
}

const ROLE_NAME: Record<number, RoleName> = {
  [ContentRole.VIEWER]: "VIEWER",
  [ContentRole.COMMENTER]: "COMMENTER",
  [ContentRole.EDITOR]: "EDITOR",
  [ContentRole.ADMIN]: "ADMIN",
  [ContentRole.OWNER]: "OWNER",
  [ContentRole.BLOCKED]: "BLOCKED",
};

const ROLE_PROTO: Record<RoleName, ContentRole> = {
  VIEWER: ContentRole.VIEWER,
  COMMENTER: ContentRole.COMMENTER,
  EDITOR: ContentRole.EDITOR,
  ADMIN: ContentRole.ADMIN,
  OWNER: ContentRole.OWNER,
  BLOCKED: ContentRole.BLOCKED,
};

const ACCESS_NAME: Record<number, AccessModeName> = {
  [AccessMode.OWNER_ONLY]: "OWNER_ONLY",
  [AccessMode.EXPLICIT_MEMBERS]: "EXPLICIT_MEMBERS",
  [AccessMode.OPEN_TO_ORG]: "OPEN_TO_ORG",
};

const ACCESS_PROTO: Record<AccessModeName, AccessMode> = {
  OWNER_ONLY: AccessMode.OWNER_ONLY,
  EXPLICIT_MEMBERS: AccessMode.EXPLICIT_MEMBERS,
  OPEN_TO_ORG: AccessMode.OPEN_TO_ORG,
};

export const ROLE_LABEL: Record<RoleName, string> = {
  VIEWER: "Viewer",
  COMMENTER: "Commenter",
  EDITOR: "Editor",
  ADMIN: "Admin",
  OWNER: "Owner",
  BLOCKED: "Blocked",
};

/** Roles that can be assigned to a member in the picker (no OWNER/BLOCKED). */
export const ASSIGNABLE_ROLES: RoleName[] = ["VIEWER", "COMMENTER", "EDITOR", "ADMIN"];

export const ACCESS_MODE_META: { key: AccessModeName; label: string; description: string }[] = [
  { key: "OWNER_ONLY", label: "Only you", description: "Private - only the owner can access" },
  {
    key: "EXPLICIT_MEMBERS",
    label: "Specific people",
    description: "Only invited members and groups can access",
  },
  {
    key: "OPEN_TO_ORG",
    label: "Everyone in org",
    description: "All members of the organization can access",
  },
];

export function roleName(role: ContentRole): RoleName {
  return ROLE_NAME[role] ?? "VIEWER";
}

export function roleToProto(role: RoleName): ContentRole {
  return ROLE_PROTO[role];
}

export function accessModeToProto(mode: AccessModeName): AccessMode {
  return ACCESS_PROTO[mode];
}

export function memberToPlain(proto: ProtoMember): SerializedMember {
  return {
    subjectType: proto.subjectType === SubjectType.GROUP ? "GROUP" : "USER",
    subjectId: proto.subjectId,
    role: roleName(proto.role),
  };
}

export function policyToPlain(proto: ContentAccessPolicy): SerializedPolicy {
  const effective =
    proto.effectiveAccessMode !== undefined && proto.effectiveAccessMode !== AccessMode.UNSPECIFIED
      ? ACCESS_NAME[proto.effectiveAccessMode]
      : (ACCESS_NAME[proto.accessMode] ?? "OWNER_ONLY");
  return {
    ownerId: proto.ownerId,
    accessMode: ACCESS_NAME[proto.accessMode] ?? "OWNER_ONLY",
    effectiveAccessMode: effective ?? "OWNER_ONLY",
    baselineRole: proto.baselineRole !== undefined ? roleName(proto.baselineRole) : null,
    callerRole: proto.callerRole !== undefined ? roleName(proto.callerRole) : null,
  };
}
