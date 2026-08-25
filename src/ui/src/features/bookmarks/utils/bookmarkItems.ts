import { UrnAvailability } from "@uniffy/proto/search/v1/search_pb";
import type { SerializedBookmarkItem } from "@/features/bookmarks/store/bookmarksSlice";

/**
 * The server may answer with an empty page plus a continuation token when a whole
 * scan window resolves to content the caller can no longer read. Stopping at the
 * first such page would strand every older bookmark behind it.
 */
export const BOOKMARK_MAX_PAGES_PER_FETCH = 4;

export function isDisplayableBookmarkItem(item: SerializedBookmarkItem): boolean {
  return (
    item.content.availability === UrnAvailability.AVAILABLE && item.content.url.trim().length > 0
  );
}
