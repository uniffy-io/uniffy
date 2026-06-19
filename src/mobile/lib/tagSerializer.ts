import type { Tag as ProtoTag, TaggedContentItem } from "@uniffy/proto/tags/v1/tags_pb";
import { ContentType } from "@uniffy/proto/common/v1/common_pb";
import type { Domain } from "@/lib/types";
import { routeFromUrn } from "@/lib/notificationSerializer";

export interface SerializedTag {
  id: string;
  name: string;
  color: string;
  description: string;
  usageCount: number;
}

export interface SerializedTaggedItem {
  urn: string;
  title: string;
  snippet: string;
  domain: Domain | null;
  route: string | null;
}

const CONTENT_TYPE_DOMAIN: Partial<Record<number, Domain>> = {
  [ContentType.NOTE]: "notes",
  [ContentType.FILE]: "files",
  [ContentType.FOLDER]: "files",
  [ContentType.CALENDAR_EVENT]: "calendar",
  [ContentType.PROJECT]: "projects",
  [ContentType.TASK]: "projects",
  [ContentType.CHAT]: "chat",
};

export function contentTypeToDomain(type: ContentType): Domain | null {
  return CONTENT_TYPE_DOMAIN[type] ?? null;
}

export function tagToPlain(proto: ProtoTag): SerializedTag {
  return {
    id: proto.id,
    name: proto.name,
    color: proto.color || "#7C5CFC",
    description: proto.description || "",
    usageCount: proto.usageCount,
  };
}

export function taggedItemToPlain(proto: TaggedContentItem): SerializedTaggedItem {
  return {
    urn: proto.urn,
    title: proto.title || "Untitled",
    snippet: proto.snippet || "",
    domain: contentTypeToDomain(proto.contentType),
    route: routeFromUrn(proto.urn),
  };
}

export const TAG_COLORS = [
  "#3B82F6",
  "#8B5CF6",
  "#10B981",
  "#EF4444",
  "#F59E0B",
  "#EC4899",
  "#14B8A6",
  "#6366F1",
  "#64748B",
];
