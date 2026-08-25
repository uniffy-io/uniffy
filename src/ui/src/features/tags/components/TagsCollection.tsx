import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { MagnifyingGlass, PencilSimple } from "@phosphor-icons/react";
import { cn } from "@/shared/utils/cn";
import { CardGridSkeleton, LoadMoreButton, SectionRule } from "@/components/ui/collection";
import { entranceDelay } from "@/shared/utils/entranceStagger";
import { useBreakpoint } from "@/shared/hooks/useBreakpoint";
import { useDocumentTitle } from "@/shared/hooks/useDocumentTitle";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { parseUrn, urnToPath } from "@/shared/utils/urn";
import { getContentTypeConfig } from "@/config/theme/contentTypes";
import type { UrnType } from "@/shared/utils/urnTypes";
import { MentionChip } from "@/components/mention";
import { TagSort } from "@uniffy/proto/tags/v1/tags_pb";
import { BookmarkTypeFilters } from "@/features/bookmarks/components/BookmarkTypeFilters";
import {
  bookmarkTypesToContentTypes,
  contentTypesToBookmarkTypes,
} from "@/features/bookmarks/utils/bookmarkTypes";
import { TAG_FILTER_TYPES } from "@/features/tags/utils/filterTypes";
import {
  listContentByTagThunk,
  listTagsThunk,
  type SerializedTag,
  type SerializedTaggedContentItem,
} from "@/features/tags/store/tagsThunks";
import { tagColorClasses } from "@/features/tags/utils/colors";
import { TagChip } from "@/features/tags/components/TagChip";
import { TagEditDialog } from "@/features/tags/components/TagEditDialog";
import { TagNotFound } from "@/features/tags/components/TagNotFound";
import { useTagFilterState } from "@/features/tags/hooks/useTagFilterState";
import { useTagsRealtime } from "@/features/tags/hooks/useTagsRealtime";
import { useTagById, useTagsByIds } from "@/features/tags/store/selectors";

function TagIndexChip({
  tag,
  active,
  search,
  onEdit,
}: {
  tag: SerializedTag;
  active: boolean;
  search: string;
  onEdit: (tag: SerializedTag) => void;
}) {
  const palette = tagColorClasses(tag.slug, tag.color);
  return (
    <span className="group/tagchip relative inline-flex">
      <Link
        to={`/library/tags/${tag.slug}${search}`}
        aria-current={active ? "page" : undefined}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium",
          "transition-all hover:brightness-110",
          palette.bg,
          palette.text,
          active && "ring-2 ring-ring ring-offset-2 ring-offset-background",
        )}
        data-testid={`library-tag-${tag.slug}`}
      >
        <span className="max-w-[14rem] truncate">#{tag.slug}</span>
        <span className="text-[10px] tabular-nums opacity-70">{tag.usageCount}</span>
      </Link>
      <button
        type="button"
        onClick={() => onEdit(tag)}
        title={`Edit #${tag.slug}`}
        aria-label={`Edit tag ${tag.name}`}
        className={cn(
          "absolute -right-1.5 -top-1.5 grid h-5 w-5 place-items-center rounded-full",
          "border border-border bg-card text-muted-foreground shadow-sm",
          "opacity-0 transition-opacity hover:text-foreground",
          "group-hover/tagchip:opacity-100 focus-visible:opacity-100",
        )}
      >
        <PencilSimple size={10} weight="bold" />
      </button>
    </span>
  );
}

function TaggedChip({ item, index }: { item: SerializedTaggedContentItem; index: number }) {
  const navigate = useNavigate();
  const parsed = parseUrn(item.urn);
  const path = urnToPath(item.urn);

  return (
    <div
      className="bookmark-card-enter library-card-cell min-w-0"
      style={entranceDelay(index)}
      data-testid={`library-tag-content-${parsed.id}`}
    >
      <MentionChip
        urn={item.urn}
        label={item.title || "Untitled"}
        forceExpanded
        onClick={() => {
          if (path !== "#") navigate(path);
        }}
      />
    </div>
  );
}

interface ContentGroup {
  type: UrnType;
  items: SerializedTaggedContentItem[];
  startIndex: number;
}

function groupContentByType(items: SerializedTaggedContentItem[]): ContentGroup[] {
  const buckets = new Map<UrnType, SerializedTaggedContentItem[]>();
  for (const item of items) {
    const type = parseUrn(item.urn).type;
    const bucket = buckets.get(type) ?? [];
    bucket.push(item);
    buckets.set(type, bucket);
  }
  const sorted = Array.from(buckets.entries()).sort((a, b) => b[1].length - a[1].length);
  let offset = 0;
  return sorted.map(([type, typeItems]) => {
    const group = { type, items: typeItems, startIndex: offset };
    offset += typeItems.length;
    return group;
  });
}

interface TagsCollectionProps {
  /** The shared Library header, slotted between the ribbon rail and the controls. */
  header: ReactNode;
}

export function TagsCollection({ header }: TagsCollectionProps) {
  const dispatch = useAppDispatch();
  const { isTabletOrDesktop } = useBreakpoint();
  const location = useLocation();
  const { slug } = useParams<{ slug?: string }>();

  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  useEffect(() => {
    const handle = window.setTimeout(() => setDebouncedSearch(searchQuery), 250);
    return () => window.clearTimeout(handle);
  }, [searchQuery]);

  const [editingTag, setEditingTag] = useState<SerializedTag | null>(null);

  const { criteria, patch } = useTagFilterState();
  useTagsRealtime();

  const bySlug = useAppSelector((s) => s.tags.bySlug);
  const listIds = useAppSelector((s) => s.tags.listIds);
  const listStatus = useAppSelector((s) => s.tags.listStatus);
  const listNextPageToken = useAppSelector((s) => s.tags.listNextPageToken);
  const contentByTag = useAppSelector((s) => s.tags.contentByTag);

  const allListedTags = useTagsByIds(listIds);
  const tags = allListedTags as SerializedTag[];

  const selectedTagId = slug ? (bySlug[slug] ?? slug) : undefined;
  const selectedTag = useTagById(selectedTagId) ?? null;
  const selectedTagSlug = selectedTag?.slug;

  useDocumentTitle(selectedTag ? `#${selectedTag.slug}` : "Library");

  const ribbonTypes = useMemo(
    () => contentTypesToBookmarkTypes(criteria.contentTypes),
    [criteria.contentTypes],
  );
  const handleRibbonChange = useCallback(
    (types: UrnType[]) => {
      patch({ contentTypes: bookmarkTypesToContentTypes(types) });
    },
    [patch],
  );

  const contentTypesKey = useMemo(() => criteria.contentTypes.join(","), [criteria.contentTypes]);
  const criteriaKey = useMemo(() => JSON.stringify(criteria), [criteria]);

  useEffect(() => {
    dispatch(
      listTagsThunk({
        query: debouncedSearch,
        sort: TagSort.RECENT_DESC,
        contentTypes: criteria.contentTypes,
      }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- contentTypesKey is the stable signature of criteria.contentTypes
  }, [dispatch, debouncedSearch, contentTypesKey]);

  useEffect(() => {
    if (!selectedTagSlug) return;
    dispatch(
      listContentByTagThunk({
        tag: selectedTagSlug,
        criteria,
      }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- criteriaKey is the stable signature of criteria
  }, [dispatch, selectedTagSlug, criteriaKey]);

  const handleLoadMoreTags = useCallback(() => {
    if (!listNextPageToken) return;
    dispatch(
      listTagsThunk({
        query: debouncedSearch,
        sort: TagSort.RECENT_DESC,
        contentTypes: criteria.contentTypes,
        pageToken: listNextPageToken,
      }),
    );
  }, [dispatch, listNextPageToken, debouncedSearch, criteria.contentTypes]);

  const contentBucket = selectedTag ? contentByTag[selectedTag.slug] : undefined;

  const handleLoadMoreContent = useCallback(() => {
    if (!selectedTag || !contentBucket?.nextPageToken) return;
    dispatch(
      listContentByTagThunk({
        tag: selectedTag.slug,
        criteria,
        pageToken: contentBucket.nextPageToken,
      }),
    );
  }, [dispatch, selectedTag, contentBucket, criteria]);

  const items = useMemo(
    () => contentBucket?.urns.map((urn) => contentBucket.items[urn]).filter(Boolean) ?? [],
    [contentBucket],
  );
  const contentGroups = useMemo(() => groupContentByType(items), [items]);

  const isTagListLoading = listStatus === "loading" && tags.length === 0;
  const tagNotFound = !!slug && !selectedTag && listStatus === "succeeded";

  const content = (
    <>
      {header}

      <div className="relative mt-5 max-w-xl">
        <MagnifyingGlass
          size={14}
          weight="duotone"
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
        />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search tags..."
          className="w-full rounded-full border border-border bg-card py-1.5 pl-8 pr-3 text-sm focus:border-primary focus:outline-none"
          data-testid="library-tag-search"
        />
      </div>

      <main className="mt-7">
        <section aria-label="All tags">
          <SectionRule label="All tags" count={tags.length} />
          {isTagListLoading ? (
            <div className="flex flex-wrap gap-2" aria-busy="true">
              {Array.from({ length: 10 }, (_, i) => (
                <span
                  key={i}
                  className="h-7 animate-pulse rounded-full bg-muted"
                  style={{ width: `${56 + ((i * 23) % 64)}px` }}
                />
              ))}
            </div>
          ) : tags.length === 0 ? (
            <p className="py-4 text-sm text-muted-foreground">
              No tags match the current search or filters.
            </p>
          ) : (
            <>
              <div className="flex flex-wrap gap-x-2 gap-y-2.5">
                {tags.map((tag) => (
                  <TagIndexChip
                    key={tag.id}
                    tag={tag}
                    active={selectedTag?.id === tag.id}
                    search={location.search}
                    onEdit={setEditingTag}
                  />
                ))}
              </div>
              {listNextPageToken && (
                <div className="mt-4">
                  <LoadMoreButton
                    onClick={handleLoadMoreTags}
                    loading={listStatus === "loading"}
                    label="More tags"
                    className="px-4 py-1.5"
                  />
                </div>
              )}
            </>
          )}
        </section>

        {tagNotFound ? (
          <section className="mt-8 rounded-xl border border-dashed border-border">
            <TagNotFound slug={slug} />
          </section>
        ) : (
          selectedTag && (
            <section className="mt-10" aria-label={`Content tagged ${selectedTag.name}`}>
              <div className="mb-4 flex flex-wrap items-baseline gap-3">
                <TagChip tag={selectedTag} nonInteractive />
                <span className="text-sm font-semibold text-foreground">{selectedTag.name}</span>
                <span className="text-xs text-muted-foreground">
                  {selectedTag.usageCount} item{selectedTag.usageCount === 1 ? "" : "s"}
                </span>
                {selectedTag.description && (
                  <span className="w-full text-xs text-muted-foreground">
                    {selectedTag.description}
                  </span>
                )}
              </div>

              {contentBucket?.status === "loading" && items.length === 0 ? (
                <CardGridSkeleton count={3} />
              ) : items.length === 0 ? (
                <p className="py-6 text-sm text-muted-foreground">
                  No content matches the current filter for{" "}
                  <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                    #{selectedTag.slug}
                  </code>
                  .
                </p>
              ) : (
                <div className="space-y-8">
                  {contentGroups.map((group) => {
                    const config = getContentTypeConfig(group.type);
                    return (
                      <section key={group.type} aria-label={config.labelPlural}>
                        <SectionRule label={config.labelPlural} count={group.items.length} />
                        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                          {group.items.map((item, i) => (
                            <TaggedChip key={item.urn} item={item} index={group.startIndex + i} />
                          ))}
                        </div>
                      </section>
                    );
                  })}
                  {contentBucket?.nextPageToken && (
                    <div className="pt-2 text-center">
                      <LoadMoreButton
                        onClick={handleLoadMoreContent}
                        loading={contentBucket.status === "loading"}
                      />
                    </div>
                  )}
                </div>
              )}
            </section>
          )
        )}
      </main>
    </>
  );

  return (
    <>
      {!isTabletOrDesktop && (
        <BookmarkTypeFilters
          types={TAG_FILTER_TYPES}
          selected={ribbonTypes}
          onChange={handleRibbonChange}
        />
      )}
      {content}

      {editingTag && <TagEditDialog tag={editingTag} onClose={() => setEditingTag(null)} />}
    </>
  );
}
