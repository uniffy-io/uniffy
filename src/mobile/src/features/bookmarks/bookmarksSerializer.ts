import type { BookmarkItem } from "@uniffy/proto/bookmarks/v1/bookmarks_pb";
import { SearchResultType, UrnAvailability } from "@uniffy/proto/search/v1/search_pb";
import type { Domain } from "@core/types";
import {
  contentTypeLabel,
  domainForType,
  idFromUrn,
  nativeRouteFor,
} from "@shared/lib/contentTypes";

export type BookmarkAvailability = "available" | "deleted" | "unavailable";

export interface SerializedBookmarkItem {
  id: string;
  urn: string;
  title: string;
  description: string;
  typeLabel: string;
  domain: Domain | null;
  route: string | null;
  availability: BookmarkAvailability;
}

function chatMessageDescription(metadata: Record<string, string>): string {
  const sender = metadata["sender_name"];
  const channel = metadata["channel_name"];
  if (sender && channel) return `${sender} in #${channel}`;
  if (channel) return `#${channel}`;
  return sender ?? "";
}

export function bookmarkItemToPlain(item: BookmarkItem): SerializedBookmarkItem | null {
  if (!item.bookmark) return null;

  const content = item.content;
  const availability: BookmarkAvailability =
    content?.availability === UrnAvailability.AVAILABLE
      ? "available"
      : content?.availability === UrnAvailability.DELETED
        ? "deleted"
        : "unavailable";

  if (availability !== "available" || !content) {
    return {
      id: item.bookmark.id,
      urn: item.bookmark.urn,
      title: "",
      description: "",
      typeLabel: contentTypeLabel(content?.type),
      domain: null,
      route: null,
      availability,
    };
  }

  const metadata = { ...content.metadata };
  const contentId = idFromUrn(item.bookmark.urn);
  const type = content.type;

  return {
    id: item.bookmark.id,
    urn: item.bookmark.urn,
    title: content.title || "Untitled",
    description:
      type === SearchResultType.CHAT_MESSAGE
        ? chatMessageDescription(metadata)
        : content.description,
    typeLabel:
      type === SearchResultType.NOTE && metadata["node_type"] === "FOLDER"
        ? "Folder"
        : contentTypeLabel(type),
    domain: domainForType(type),
    route: nativeRouteFor(type, contentId, metadata),
    availability,
  };
}
