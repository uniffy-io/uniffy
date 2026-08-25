import { SearchResultType } from "@uniffy/proto/search/v1/search_pb";
import type { Domain } from "@core/types";

const TYPE_LABELS: Partial<Record<SearchResultType, string>> = {
  [SearchResultType.NOTE]: "Note",
  [SearchResultType.FILE]: "File",
  [SearchResultType.FOLDER]: "Folder",
  [SearchResultType.CHAT]: "Chat",
  [SearchResultType.AGENT_CHAT]: "Agent Chat",
  [SearchResultType.AGENT_FOLDER]: "Agent Chat Folder",
  [SearchResultType.CHAT_MESSAGE]: "Message",
  [SearchResultType.USER]: "User",
  [SearchResultType.TEAM]: "Team",
  [SearchResultType.CALENDAR_EVENT]: "Event",
  [SearchResultType.PROJECT]: "Project",
  [SearchResultType.TASK]: "Task",
  [SearchResultType.AGENT]: "Agent",
  [SearchResultType.ROOM]: "Room",
  [SearchResultType.TAG]: "Tag",
  [SearchResultType.AGENT_CRON_TASK]: "Automation",
};

/** Agent chats open under `/chat`, so they belong to the chat domain everywhere. */
const TYPE_DOMAINS: Partial<Record<SearchResultType, Domain>> = {
  [SearchResultType.NOTE]: "notes",
  [SearchResultType.FILE]: "files",
  [SearchResultType.FOLDER]: "files",
  [SearchResultType.CHAT]: "chat",
  [SearchResultType.AGENT_CHAT]: "chat",
  [SearchResultType.AGENT_FOLDER]: "chat",
  [SearchResultType.CHAT_MESSAGE]: "chat",
  [SearchResultType.CALENDAR_EVENT]: "calendar",
  [SearchResultType.PROJECT]: "projects",
  [SearchResultType.TASK]: "projects",
  [SearchResultType.AGENT]: "agents",
  [SearchResultType.AGENT_CRON_TASK]: "agents",
};

export function idFromUrn(urn: string): string {
  const parts = urn.split(":");
  return parts[parts.length - 1] ?? urn;
}

export function contentTypeLabel(type: SearchResultType | undefined): string {
  return TYPE_LABELS[type ?? SearchResultType.UNSPECIFIED] ?? "Item";
}

export function domainForType(type: SearchResultType): Domain | null {
  return TYPE_DOMAINS[type] ?? null;
}

/**
 * Native route for a resolved content item. The backend `url` targets the web app,
 * whose paths differ from expo-router, so build the path from type + metadata.
 * Chat messages open their channel via the authorized `channel_id` metadata.
 */
export function nativeRouteFor(
  type: SearchResultType,
  id: string,
  metadata: Record<string, string> = {},
): string | null {
  switch (type) {
    case SearchResultType.NOTE:
      return metadata["node_type"] === "FOLDER" ? `/notes/folder/${id}` : `/notes/${id}`;
    case SearchResultType.FILE:
      return `/files/${id}`;
    case SearchResultType.FOLDER:
      return `/files?folder=${id}`;
    case SearchResultType.CHAT:
    case SearchResultType.AGENT_CHAT:
      return `/chat/${id}`;
    case SearchResultType.CHAT_MESSAGE: {
      const channelId = metadata["channel_id"];
      return channelId ? `/chat/${channelId}` : null;
    }
    case SearchResultType.CALENDAR_EVENT:
      return `/calendar/${id}`;
    case SearchResultType.PROJECT:
      return `/projects/${id}`;
    case SearchResultType.TASK:
      return `/projects/task/${id}`;
    case SearchResultType.TAG:
      return `/tags/${id}`;
    default:
      return null;
  }
}
