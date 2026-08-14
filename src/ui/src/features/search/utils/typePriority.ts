import { SearchResultType } from "@uniffy/proto/search/v1/search_pb";

// Ranking happens backend-side (SearchRequest.type_priority); these lists
// declare the domain context the user is searching from. Listed types float
// to the top within match-strength buckets.
export const CHAT_CONTEXT_TYPE_PRIORITY: SearchResultType[] = [
  SearchResultType.USER,
  SearchResultType.CHAT,
  SearchResultType.AGENT_CHAT,
  SearchResultType.CHAT_MESSAGE,
];

const ROUTE_TYPE_PRIORITY: Array<{ prefix: string; priority: SearchResultType[] }> = [
  { prefix: "/chat", priority: CHAT_CONTEXT_TYPE_PRIORITY },
  { prefix: "/files", priority: [SearchResultType.FILE, SearchResultType.FOLDER] },
  { prefix: "/notes", priority: [SearchResultType.NOTE] },
  {
    prefix: "/calendar",
    priority: [SearchResultType.CALENDAR_EVENT, SearchResultType.USER, SearchResultType.ROOM],
  },
  { prefix: "/projects", priority: [SearchResultType.TASK, SearchResultType.PROJECT] },
  { prefix: "/portfolio", priority: [SearchResultType.PROJECT, SearchResultType.TASK] },
  {
    prefix: "/agents",
    priority: [SearchResultType.AGENT, SearchResultType.AGENT_CHAT, SearchResultType.AGENT_FOLDER],
  },
];

export function getRouteTypePriority(pathname: string): SearchResultType[] | undefined {
  return ROUTE_TYPE_PRIORITY.find((entry) => pathname.startsWith(entry.prefix))?.priority;
}
