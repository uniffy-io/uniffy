import type { SearchResultItem } from "@uniffy/proto/search/v1/search_pb";
import { SearchResultType } from "@uniffy/proto/search/v1/search_pb";
import type { Domain } from "@/lib/types";

export interface SerializedSearchResult {
  id: string;
  urn: string;
  title: string;
  domain: Domain | null;
  type: SearchResultType;
  description?: string;
  route?: string;
  tags: string[];
}

const TYPE_TO_DOMAIN: Partial<Record<SearchResultType, Domain>> = {
  [SearchResultType.NOTE]: "notes",
  [SearchResultType.FILE]: "files",
  [SearchResultType.CHAT]: "chat",
  [SearchResultType.CALENDAR_EVENT]: "calendar",
  [SearchResultType.PROJECT]: "projects",
  [SearchResultType.TASK]: "projects",
  [SearchResultType.AGENT]: "agents",
  [SearchResultType.AGENT_CHAT]: "agents",
};

const DOMAIN_TO_TYPES: Record<Domain, SearchResultType[]> = {
  notes: [SearchResultType.NOTE],
  files: [SearchResultType.FILE],
  chat: [SearchResultType.CHAT],
  calendar: [SearchResultType.CALENDAR_EVENT],
  projects: [SearchResultType.PROJECT, SearchResultType.TASK],
  agents: [SearchResultType.AGENT, SearchResultType.AGENT_CHAT],
};

export function idFromUrn(urn: string): string {
  const parts = urn.split(":");
  return parts[parts.length - 1] ?? urn;
}

export function typeToDomain(type: SearchResultType): Domain | null {
  return TYPE_TO_DOMAIN[type] ?? null;
}

export function searchResultToPlain(item: SearchResultItem): SerializedSearchResult {
  const id = idFromUrn(item.urn);
  const domain = TYPE_TO_DOMAIN[item.type] ?? null;
  return {
    id,
    urn: item.urn,
    title: item.title,
    domain,
    type: item.type,
    description: item.description || undefined,
    route: mobileRouteFor(item.type, id) ?? (item.url || undefined),
    tags: [...item.tags],
  };
}

export function domainToTypeFilters(domain: Domain): SearchResultType[] {
  return DOMAIN_TO_TYPES[domain] ?? [];
}

/**
 * Mobile route for a search hit. The backend `url` targets the web app, whose
 * paths (notably tasks) differ from expo-router, so build the path from the
 * type + id instead of trusting `url`.
 */
export function mobileRouteFor(type: SearchResultType, id: string): string | null {
  switch (type) {
    case SearchResultType.NOTE:
      return `/notes/${id}`;
    case SearchResultType.FILE:
      return `/files/${id}`;
    case SearchResultType.CHAT:
    case SearchResultType.AGENT_CHAT:
      return `/chat/${id}`;
    case SearchResultType.CALENDAR_EVENT:
      return `/calendar/${id}`;
    case SearchResultType.PROJECT:
      return `/projects/${id}`;
    case SearchResultType.TASK:
      return `/projects/task/${id}`;
    default:
      return null;
  }
}
