import { useMemo, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowClockwise, BookmarkSimple } from "@phosphor-icons/react";
import { fromJsonString } from "@bufbuild/protobuf";
import { UrnAvailability, UrnMetadataSchema } from "@uniffy/proto/search/v1/search_pb";
import { cn } from "@/shared/utils/cn";
import { Card } from "@/components/ui/card";
import { CardGridSkeleton, LoadMoreButton, SectionRule } from "@/components/ui/collection";
import { entranceDelay } from "@/shared/utils/entranceStagger";
import { useBreakpoint } from "@/shared/hooks/useBreakpoint";
import { useDocumentTitle } from "@/shared/hooks/useDocumentTitle";
import { MentionChip } from "@/components/mention";
import { useBookmarkItems, useBookmarkToggle } from "@/features/bookmarks/hooks/useBookmarks";
import { useSavedTypesFilter } from "@/features/bookmarks/hooks/useSavedTypesFilter";
import { BookmarkTypeFilters } from "@/features/bookmarks/components/BookmarkTypeFilters";
import type { SerializedBookmarkItem } from "@/features/bookmarks/store/bookmarksSlice";

const DAY_MS = 86_400_000;

type TimeGroupKey = "today" | "yesterday" | "week" | "month" | "earlier";

const TIME_GROUPS: Record<TimeGroupKey, string> = {
  today: "Today",
  yesterday: "Yesterday",
  week: "Past week",
  month: "Past month",
  earlier: "Earlier",
};

function timeGroupFor(iso: string, now: Date): TimeGroupKey {
  const saved = new Date(iso).getTime();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (saved >= startOfToday) return "today";
  if (saved >= startOfToday - DAY_MS) return "yesterday";
  if (saved >= startOfToday - 7 * DAY_MS) return "week";
  if (saved >= startOfToday - 30 * DAY_MS) return "month";
  return "earlier";
}

interface TimeGroup {
  key: TimeGroupKey;
  label: string;
  items: SerializedBookmarkItem[];
  /** Offset into the full list so the entrance stagger cascades across groups. */
  startIndex: number;
}

function groupByTime(items: SerializedBookmarkItem[]): TimeGroup[] {
  const now = new Date();
  const groups: TimeGroup[] = [];
  for (const [index, item] of items.entries()) {
    const key = timeGroupFor(item.createdAt, now);
    const current = groups[groups.length - 1];
    if (current?.key === key) {
      current.items.push(item);
    } else {
      groups.push({ key, label: TIME_GROUPS[key], items: [item], startIndex: index });
    }
  }
  return groups;
}

function availabilityAttr(item: SerializedBookmarkItem): string {
  switch (item.content.availability) {
    case UrnAvailability.AVAILABLE:
      return "available";
    case UrnAvailability.DELETED:
      return "deleted";
    default:
      return "unavailable";
  }
}

function SavedChip({ item, index }: { item: SerializedBookmarkItem; index: number }) {
  const navigate = useNavigate();
  const { toggling, toggle } = useBookmarkToggle(item.urn);
  const resolvedMetadata = useMemo(
    () => fromJsonString(UrnMetadataSchema, item.contentJson),
    [item.contentJson],
  );

  return (
    <div
      className="group/saved bookmark-card-enter library-card-cell relative min-w-0"
      style={entranceDelay(index)}
      data-testid={`bookmark-item-${item.id}`}
      data-availability={availabilityAttr(item)}
    >
      <MentionChip
        urn={item.urn}
        label={item.content.title || "Untitled"}
        resolvedMetadata={resolvedMetadata}
        forceExpanded
        onClick={() => {
          if (item.content.url) navigate(item.content.url);
        }}
      />
      <button
        type="button"
        onClick={toggle}
        disabled={toggling}
        title="Remove bookmark"
        aria-label="Remove bookmark"
        className={cn(
          "absolute -right-1.5 -top-1.5 z-10 grid h-6 w-6 place-items-center rounded-full",
          "border border-border bg-card text-primary shadow-sm",
          "opacity-0 transition-opacity hover:bg-muted",
          "group-hover/saved:opacity-100 focus-visible:opacity-100 disabled:opacity-50",
        )}
        data-testid={`bookmark-remove-${item.id}`}
      >
        <BookmarkSimple size={12} weight="fill" />
      </button>
    </div>
  );
}

function EmptyCollection({ filtered }: { filtered: boolean }) {
  const ghostHeights = ["h-10", "h-16", "h-12", "h-20", "h-14"];
  return (
    <div className="flex flex-col items-center px-6 pb-16 pt-4 text-center">
      <div className="flex items-start gap-3" aria-hidden="true">
        {ghostHeights.map((height, i) => (
          <span
            key={i}
            className={cn(
              "bookmark-ribbon w-7 bg-muted-foreground/15",
              height,
              i === 3 && "bg-primary/25",
            )}
            style={{ animationDelay: `${i * 70}ms` }}
          />
        ))}
      </div>
      <h2 className="mt-8 text-lg font-semibold tracking-tight text-foreground">
        {filtered ? "No bookmarks match this filter" : "Nothing saved yet"}
      </h2>
      <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">
        {filtered
          ? "Try another type, or clear the filter to see everything you saved."
          : "Save a note, a file, a message, or an event anywhere in Uniffy and it will wait for you here."}
      </p>
    </div>
  );
}

interface BookmarksCollectionProps {
  /** The shared Library header, slotted between the ribbon rail and the content. */
  header: ReactNode;
}

export function BookmarksCollection({ header }: BookmarksCollectionProps) {
  useDocumentTitle("Library");
  const { isTabletOrDesktop } = useBreakpoint();
  const { selected: selectedTypes, setSelected: handleTypesChange } = useSavedTypesFilter();

  const { items, status, error, hasMore, loadMore, retry } = useBookmarkItems("page", {
    types: selectedTypes,
  });

  const groups = useMemo(() => groupByTime(items), [items]);

  const isInitialLoading = status === "loading" && items.length === 0;
  // A token-bearing empty page means more bookmarks sit behind a scan window of
  // revoked content; showing the empty state there would strand them.
  const isEmpty = status === "succeeded" && items.length === 0 && !hasMore;

  const content = (
    <>
      {header}

      <main className="mt-6">
        {isInitialLoading ? (
          <CardGridSkeleton />
        ) : status === "failed" && items.length === 0 ? (
          <Card className="flex flex-col items-center gap-3 px-6 py-12 text-center">
            <p className="text-sm text-muted-foreground">
              {error ?? "Bookmarks could not be loaded."}
            </p>
            <button
              type="button"
              onClick={retry}
              className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              data-testid="bookmarks-retry"
            >
              <ArrowClockwise size={14} />
              Try again
            </button>
          </Card>
        ) : isEmpty ? (
          <EmptyCollection filtered={selectedTypes.length > 0} />
        ) : (
          <div className="space-y-7" data-testid="bookmarks-list">
            {groups.map((group) => (
              <section key={group.key} aria-label={group.label}>
                <SectionRule label={group.label} count={group.items.length} />
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {group.items.map((item, i) => (
                    <SavedChip key={item.id} item={item} index={group.startIndex + i} />
                  ))}
                </div>
              </section>
            ))}

            {items.length === 0 && (
              <p className="py-10 text-center text-sm text-muted-foreground">
                Nothing to show in this stretch of your saved items. Keep looking to reach older
                bookmarks.
              </p>
            )}

            {hasMore && (
              <div className="pt-2 text-center">
                <LoadMoreButton
                  onClick={loadMore}
                  loading={status === "loadingMore"}
                  testId="bookmarks-load-more"
                />
              </div>
            )}
          </div>
        )}
      </main>
    </>
  );

  if (isTabletOrDesktop) return content;

  return (
    <>
      <BookmarkTypeFilters selected={selectedTypes} onChange={handleTypesChange} />
      {content}
    </>
  );
}
