import { ContentType } from "@uniffy/proto/common/v1/common_pb";
import { UrnType } from "@/shared/utils/urnTypes";

/** UrnType values double as the `?types=` URL vocabulary for /bookmarks. */
export const URN_TYPE_TO_CONTENT_TYPE: Partial<Record<UrnType, ContentType>> = {
  [UrnType.NOTE]: ContentType.NOTE,
  [UrnType.FILE]: ContentType.FILE,
  [UrnType.FOLDER]: ContentType.FOLDER,
  [UrnType.CHAT]: ContentType.CHAT,
  [UrnType.AGENT_CHAT]: ContentType.AGENT_CHAT,
  [UrnType.AGENT_FOLDER]: ContentType.AGENT_FOLDER,
  [UrnType.CHAT_MESSAGE]: ContentType.CHAT_MESSAGE,
  [UrnType.USER]: ContentType.USER,
  [UrnType.TEAM]: ContentType.TEAM,
  [UrnType.CALENDAR_EVENT]: ContentType.CALENDAR_EVENT,
  [UrnType.PROJECT]: ContentType.PROJECT,
  [UrnType.TASK]: ContentType.TASK,
  [UrnType.AGENT]: ContentType.AGENT,
  [UrnType.AGENT_CRON_TASK]: ContentType.AGENT_CRON_TASK,
  [UrnType.ROOM]: ContentType.ROOM,
  [UrnType.TAG]: ContentType.TAG,
};

/** Filter chips offered on the bookmarks page; any mapped UrnType is still accepted from the URL. */
export const BOOKMARK_FILTER_TYPES: UrnType[] = [
  UrnType.NOTE,
  UrnType.FILE,
  UrnType.FOLDER,
  UrnType.CHAT_MESSAGE,
  UrnType.CALENDAR_EVENT,
  UrnType.PROJECT,
  UrnType.TASK,
  UrnType.CHAT,
  UrnType.AGENT,
  UrnType.ROOM,
];

export function parseBookmarkTypesParam(param: string | null): UrnType[] {
  if (!param) return [];
  const seen = new Set<UrnType>();
  for (const raw of param.split(",")) {
    const value = raw.trim() as UrnType;
    if (URN_TYPE_TO_CONTENT_TYPE[value] !== undefined) {
      seen.add(value);
    }
  }
  return Array.from(seen);
}

export function serializeBookmarkTypesParam(types: UrnType[]): string {
  return types.join(",");
}

export function bookmarkTypesToContentTypes(types: UrnType[]): ContentType[] {
  return types
    .map((type) => URN_TYPE_TO_CONTENT_TYPE[type])
    .filter((value): value is ContentType => value !== undefined);
}

const CONTENT_TYPE_TO_URN_TYPE = new Map<ContentType, UrnType>(
  Object.entries(URN_TYPE_TO_CONTENT_TYPE).map(([urnType, contentType]) => [
    contentType as ContentType,
    urnType as UrnType,
  ]),
);

export function contentTypesToBookmarkTypes(types: ContentType[]): UrnType[] {
  return types
    .map((type) => CONTENT_TYPE_TO_URN_TYPE.get(type))
    .filter((value): value is UrnType => value !== undefined);
}
