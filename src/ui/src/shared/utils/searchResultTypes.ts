import { SearchResultType } from "@uniffy/proto/search/v1/search_pb";
import { UrnType } from "@/shared/utils/urnTypes";

export const SEARCH_RESULT_TYPE_TO_URN_TYPE: Record<number, UrnType> = {
  [SearchResultType.NOTE]: UrnType.NOTE,
  [SearchResultType.FILE]: UrnType.FILE,
  [SearchResultType.FOLDER]: UrnType.FOLDER,
  [SearchResultType.CHAT]: UrnType.CHAT,
  [SearchResultType.AGENT_CHAT]: UrnType.AGENT_CHAT,
  [SearchResultType.AGENT_FOLDER]: UrnType.AGENT_FOLDER,
  [SearchResultType.CHAT_MESSAGE]: UrnType.CHAT_MESSAGE,
  [SearchResultType.USER]: UrnType.USER,
  [SearchResultType.TEAM]: UrnType.TEAM,
  [SearchResultType.CALENDAR]: UrnType.CALENDAR,
  [SearchResultType.CALENDAR_EVENT]: UrnType.CALENDAR_EVENT,
  [SearchResultType.PROJECT]: UrnType.PROJECT,
  [SearchResultType.TASK]: UrnType.TASK,
  [SearchResultType.AGENT]: UrnType.AGENT,
  [SearchResultType.ROOM]: UrnType.ROOM,
  [SearchResultType.TAG]: UrnType.TAG,
  [SearchResultType.AGENT_CRON_TASK]: UrnType.AGENT_CRON_TASK,
};

export function searchResultTypeToUrnType(type: SearchResultType): UrnType {
  return SEARCH_RESULT_TYPE_TO_URN_TYPE[type] ?? UrnType.UNKNOWN;
}
