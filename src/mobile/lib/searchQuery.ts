import { SearchResultType } from "@uniffy/proto/search/v1/search_pb";

export interface ParsedQuery {
  text: string;
  types: SearchResultType[];
  tags: string[];
  myContentOnly: boolean;
}

const TYPE_KEYWORD_MAP: Record<string, SearchResultType> = {
  note: SearchResultType.NOTE,
  notes: SearchResultType.NOTE,
  file: SearchResultType.FILE,
  files: SearchResultType.FILE,
  chat: SearchResultType.CHAT,
  chats: SearchResultType.CHAT,
  channel: SearchResultType.CHAT,
  message: SearchResultType.CHAT_MESSAGE,
  msg: SearchResultType.CHAT_MESSAGE,
  event: SearchResultType.CALENDAR_EVENT,
  events: SearchResultType.CALENDAR_EVENT,
  calendar: SearchResultType.CALENDAR_EVENT,
  project: SearchResultType.PROJECT,
  projects: SearchResultType.PROJECT,
  task: SearchResultType.TASK,
  tasks: SearchResultType.TASK,
  user: SearchResultType.USER,
  users: SearchResultType.USER,
  agent: SearchResultType.AGENT,
  agents: SearchResultType.AGENT,
};

/**
 * Parse `type:` / `tag:` / `is:mine` prefixes out of a raw query string so the
 * compose box doubles as a filter bar (mirrors the web `queryParser`).
 */
export function parseSearchQuery(raw: string): ParsedQuery {
  const types = new Set<SearchResultType>();
  const tags: string[] = [];
  let myContentOnly = false;
  const textParts: string[] = [];

  for (const token of raw.split(/\s+/)) {
    if (!token) continue;
    const colon = token.indexOf(":");
    if (colon > 0) {
      const prefix = token.slice(0, colon).toLowerCase();
      const value = token.slice(colon + 1);
      if ((prefix === "type" || prefix === "in") && TYPE_KEYWORD_MAP[value.toLowerCase()]) {
        types.add(TYPE_KEYWORD_MAP[value.toLowerCase()]);
        continue;
      }
      if (prefix === "tag" && value) {
        tags.push(value);
        continue;
      }
      if (prefix === "is" && value.toLowerCase() === "mine") {
        myContentOnly = true;
        continue;
      }
    }
    // Bare shorthand like `notes` or `tasks` also narrows the type.
    const asType = TYPE_KEYWORD_MAP[token.toLowerCase()];
    if (asType !== undefined && textParts.length === 0) {
      types.add(asType);
      continue;
    }
    textParts.push(token);
  }

  return {
    text: textParts.join(" "),
    types: [...types],
    tags,
    myContentOnly,
  };
}
