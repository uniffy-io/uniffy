import { create } from "@bufbuild/protobuf";
import type { SearchResultItem, SearchResultType } from "@uniffy/proto/search/v1/search_pb";
import { SearchResultItemSchema } from "@uniffy/proto/search/v1/search_pb";

// Local per-user open history feeding the spotlight zero state. Keyed per
// org AND user so shared machines never leak titles across accounts.
export interface RecentItem {
  urn: string;
  title: string;
  type: SearchResultType;
  url: string;
  ts: number;
}

const MAX_RECENT_ITEMS = 10;

function storageKey(organizationId: string, userId: string): string {
  return `uniffy:recent-items:${organizationId}:${userId}`;
}

export function getRecentItems(organizationId: string, userId: string): RecentItem[] {
  try {
    const raw = localStorage.getItem(storageKey(organizationId, userId));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is RecentItem =>
        !!item &&
        typeof item === "object" &&
        typeof (item as RecentItem).urn === "string" &&
        typeof (item as RecentItem).title === "string" &&
        typeof (item as RecentItem).url === "string",
    );
  } catch {
    return [];
  }
}

export function recordRecentItem(
  organizationId: string,
  userId: string,
  item: Omit<RecentItem, "ts">,
): void {
  if (!item.title.trim()) return;
  try {
    const existing = getRecentItems(organizationId, userId).filter((r) => r.urn !== item.urn);
    const next = [{ ...item, ts: Date.now() }, ...existing].slice(0, MAX_RECENT_ITEMS);
    localStorage.setItem(storageKey(organizationId, userId), JSON.stringify(next));
  } catch {
    // Quota or privacy-mode failure loses history, nothing else.
  }
}

export function recentItemToSearchResult(item: RecentItem): SearchResultItem {
  return create(SearchResultItemSchema, {
    urn: item.urn,
    title: item.title,
    type: item.type,
    url: item.url,
  });
}
