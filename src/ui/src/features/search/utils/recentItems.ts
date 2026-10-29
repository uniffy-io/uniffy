import { create } from "@bufbuild/protobuf";
import type { SearchResultItem } from "@uniffy/proto/search/v1/search_pb";
import { SearchResultItemSchema, SearchResultType } from "@uniffy/proto/search/v1/search_pb";

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
const STORAGE_KEY_PREFIX = "uniffy:recent-items:";

function storageKey(organizationId: string, userId: string): string {
  return `${STORAGE_KEY_PREFIX}${organizationId}:${userId}`;
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
        typeof (item as RecentItem).url === "string" &&
        (item as RecentItem).type !== SearchResultType.CALL,
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
  if (!item.title.trim() || item.type === SearchResultType.CALL) return;
  try {
    const existing = getRecentItems(organizationId, userId).filter((r) => r.urn !== item.urn);
    const next = [{ ...item, ts: Date.now() }, ...existing].slice(0, MAX_RECENT_ITEMS);
    localStorage.setItem(storageKey(organizationId, userId), JSON.stringify(next));
  } catch {
    // Quota or privacy-mode failure loses history, nothing else.
  }
}

/** Titles name the content of every organization the user opened; sign-out removes them all. */
export function clearRecentItemsForUser(userId: string): void {
  try {
    const suffix = `:${userId}`;
    const keys: string[] = [];
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index);
      if (key?.startsWith(STORAGE_KEY_PREFIX) && key.endsWith(suffix)) keys.push(key);
    }
    for (const key of keys) localStorage.removeItem(key);
  } catch {
    // Storage can be unavailable (private mode); nothing was recorded then.
  }
}

/** A lost grant takes that organization's titles with it; the user's other organizations keep theirs. */
export function clearRecentItemsForOrganization(organizationId: string, userId: string): void {
  try {
    localStorage.removeItem(storageKey(organizationId, userId));
  } catch {
    // Storage can be unavailable (private mode); nothing was recorded then.
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
