import type { Tag as ProtoTag, TaggedContentItem } from "@uniffy/proto/tags/v1/tags_pb";
import { ContentType } from "@uniffy/proto/common/v1/common_pb";
import type { UrnMetadata } from "@uniffy/proto/search/v1/search_pb";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import type { Domain } from "@core/types";
import { urnTypeOf, type UrnType } from "@shared/lib/contentTypes";
import { isHexColor } from "@theme/brandRamp";
import { routeFromUrn } from "@features/notifications/notificationSerializer";

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
  type: UrnType | null;
  domain: Domain | null;
  route: string | null;
  /** Last content change, ISO; the library card's age. */
  updatedAt: string;
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

const DEFAULT_TAG_COLOR = "#7C5CFC";

/** The colour is stored as the client sent it, so anything but "#rrggbb" paints as the default. */
export function tagColorOrDefault(raw: string | undefined): string {
  return isHexColor(raw) ? raw : DEFAULT_TAG_COLOR;
}

export function tagToPlain(proto: ProtoTag): SerializedTag {
  return {
    id: proto.id,
    name: proto.name,
    color: tagColorOrDefault(proto.color),
    description: proto.description || "",
    usageCount: proto.usageCount,
  };
}

/**
 * The list carries bare URNs; the resolver supplies title, snippet, and last
 * change, the way the web's cards fill themselves. An unresolved item (gone
 * or out of reach since it was tagged) keeps its assignment date as the age.
 */
export function taggedItemToPlain(
  proto: TaggedContentItem,
  resolved?: UrnMetadata,
): SerializedTaggedItem {
  const changedAt = resolved?.metadata["updated_at"];
  const stamp = proto.updatedAt ?? proto.assignedAt;
  return {
    urn: proto.urn,
    title: resolved?.title || proto.title || "Untitled",
    snippet: resolved?.description || proto.snippet || "",
    type: urnTypeOf(proto.urn),
    domain: contentTypeToDomain(proto.contentType),
    route: routeFromUrn(proto.urn),
    updatedAt: changedAt || (stamp ? timestampDate(stamp).toISOString() : ""),
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
