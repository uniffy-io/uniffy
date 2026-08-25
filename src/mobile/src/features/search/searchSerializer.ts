import type { SearchResultItem } from "@uniffy/proto/search/v1/search_pb";
import { SearchResultType } from "@uniffy/proto/search/v1/search_pb";
import type { Domain } from "@core/types";
import { domainForType, idFromUrn, nativeRouteFor } from "@shared/lib/contentTypes";

export { idFromUrn };

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

/** Which result types a domain-scoped search asks the server for. */
const DOMAIN_TO_TYPES: Record<Domain, SearchResultType[]> = {
  notes: [SearchResultType.NOTE],
  files: [SearchResultType.FILE],
  chat: [SearchResultType.CHAT],
  calendar: [SearchResultType.CALENDAR_EVENT],
  projects: [SearchResultType.PROJECT, SearchResultType.TASK],
  agents: [SearchResultType.AGENT, SearchResultType.AGENT_CHAT],
};

export function searchResultToPlain(item: SearchResultItem): SerializedSearchResult {
  const id = idFromUrn(item.urn);
  return {
    id,
    urn: item.urn,
    title: item.title,
    domain: domainForType(item.type),
    type: item.type,
    description: item.description || undefined,
    route: nativeRouteFor(item.type, id) ?? (item.url || undefined),
    tags: [...item.tags],
  };
}

export function domainToTypeFilters(domain: Domain): SearchResultType[] {
  return DOMAIN_TO_TYPES[domain] ?? [];
}
