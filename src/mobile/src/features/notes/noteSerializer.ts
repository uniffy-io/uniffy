import type { Note } from "@uniffy/proto/notes/v1/notes_pb";
import { AccessMode } from "@uniffy/proto/common/v1/common_pb";

export interface PlainTimestamp {
  seconds: number;
  nanos: number;
}

export interface SerializedNote {
  id: string;
  organizationId: string;
  ownerId: string;
  title: string;
  content: string;
  slug: string;
  nodeType: number;
  accessMode: number;
  baselineRole?: number;
  userRole: number;
  visibility: number;
  parentId?: string;
  isDeleted: boolean;
  version: number;
  createdAt?: PlainTimestamp;
  updatedAt?: PlainTimestamp;
  deletedAt?: PlainTimestamp;
  groupIds: string[];
  outgoingReferences: string[];
  icon?: { type: string; value: string };
  ownerInfo?: { id: string; name: string; email: string };
  sharedWith:
    | {
        id: string;
        type: string;
        name: string;
        email: string;
        memberCount: number;
        role: number;
      }[]
    | null;
  tags: string[];
  metadata: { [key: string]: string };
}

// Notes predate the unified access model in the mobile UI; the tree groups by
// the older private/group/organization scopes, so map the access mode onto them.
export const NoteVisibility = {
  PRIVATE: 1,
  GROUP: 2,
  ORGANIZATION: 3,
} as const;

function accessModeToVisibility(mode: number): number {
  switch (mode) {
    case AccessMode.OWNER_ONLY:
      return NoteVisibility.PRIVATE;
    case AccessMode.EXPLICIT_MEMBERS:
      return NoteVisibility.GROUP;
    case AccessMode.OPEN_TO_ORG:
      return NoteVisibility.ORGANIZATION;
    default:
      return NoteVisibility.PRIVATE;
  }
}

function tsToPlain(ts?: { seconds: bigint; nanos: number }): PlainTimestamp | undefined {
  if (!ts) return undefined;
  return { seconds: Number(ts.seconds), nanos: ts.nanos };
}

export function noteToPlain(note: Note): SerializedNote {
  return {
    id: note.id,
    organizationId: note.organizationId,
    ownerId: note.ownerId,
    title: note.title,
    content: note.content,
    slug: note.slug ?? "",
    nodeType: note.nodeType ?? 0,
    accessMode: note.accessMode ?? 0,
    baselineRole: note.baselineRole,
    userRole: note.userRole,
    visibility: accessModeToVisibility(note.accessMode ?? 0),
    parentId: note.parentId,
    isDeleted: note.isDeleted,
    version: Number(note.version),
    createdAt: tsToPlain(note.createdAt),
    updatedAt: tsToPlain(note.updatedAt),
    deletedAt: tsToPlain(note.deletedAt),
    groupIds: note.groupIds,
    outgoingReferences: note.outgoingReferences,
    icon: note.icon ? { type: note.icon.iconType, value: note.icon.value } : undefined,
    ownerInfo: note.ownerInfo
      ? { id: note.ownerInfo.id, name: note.ownerInfo.name, email: note.ownerInfo.email }
      : undefined,
    sharedWith:
      note.sharedWith.length > 0
        ? note.sharedWith.map((s) => ({
            id: s.id,
            type: s.type,
            name: s.name,
            email: s.email,
            memberCount: s.memberCount,
            role: s.role,
          }))
        : null,
    tags: note.tags.map((t) => t.name),
    metadata: note.metadata,
  };
}

export function stripMarkdown(markdown: string): string {
  return markdown
    .replace(/\[\[\[([^\]|]+)\|[^\]]+\]\]\]/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/`{1,3}([^`]*)`{1,3}/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^>\s+/gm, "")
    .replace(/^[-*+]\s+/gm, "")
    .replace(/^\d+\.\s+/gm, "")
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/(\*|_)(.*?)\1/g, "$2")
    .replace(/~~(.*?)~~/g, "$1")
    .replace(/\r?\n+/g, " ")
    .trim();
}
