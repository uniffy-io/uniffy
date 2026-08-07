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
  tags: SerializedNoteTag[];
  metadata: { [key: string]: string };
}

export interface SerializedNoteTag {
  id: string;
  name: string;
  color: string;
}

export type ContentBucket = "personal" | "shared" | "organization";

// Mirrors bucketForContent in the web app
// (src/ui/src/shared/utils/contentRoles.ts). Keep the two in step: anything
// open to the org is organization content, and everything else splits on
// ownership, so a note shared WITH me reads as shared while one I own and
// shared out stays personal.
export function bucketForNote(accessMode: number, ownerId: string, userId: string): ContentBucket {
  if (accessMode === AccessMode.OPEN_TO_ORG) return "organization";
  return ownerId === userId ? "personal" : "shared";
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
    tags: note.tags.map((t) => ({ id: t.id, name: t.name, color: t.color || "#7C5CFC" })),
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
