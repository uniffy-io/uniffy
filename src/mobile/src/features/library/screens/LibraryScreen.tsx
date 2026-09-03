import React, { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import Svg, { Polygon } from "react-native-svg";
import { MagnifyingGlass, Plus, Tag as TagIcon, X } from "phosphor-react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { DomainHeader } from "@shared/components/DomainHeader";
import { useTheme } from "@shared/hooks/useTheme";
import { useDebouncedValue } from "@shared/hooks/useDebouncedValue";
import { userFacingError } from "@shared/lib/userFacingError";
import { BOTTOM_NAV_HEIGHT } from "@theme/theme";
import { FONT } from "@theme/typography";
import { withAlpha } from "@theme/brandRamp";
import { formatRelativeTime } from "@shared/lib/dateFormatting";
import type { UrnType } from "@shared/lib/contentTypes";
import { useBookmarkItems, useToggleBookmark } from "@features/bookmarks/useBookmarks";
import type { SerializedBookmarkItem } from "@features/bookmarks/bookmarksSerializer";
import { useTags, useTagMutations } from "@features/tags/useTags";
import type { SerializedTag } from "@features/tags/tagSerializer";
import { TagEditorModal } from "@features/tags/components/TagEditorModal";
import {
  BOOKMARK_FILTER_TYPES,
  TAG_FILTER_TYPES,
  toContentTypes,
} from "@features/library/libraryTypes";
import { RibbonRail } from "@features/library/components/RibbonRail";
import { LibraryTabs, type LibraryTab } from "@features/library/components/LibraryTabs";
import { SectionRule } from "@features/library/components/SectionRule";
import { LibraryCard, type LibraryCardItem } from "@features/library/components/LibraryCard";
import { LoadFailed } from "@features/library/components/LoadFailed";
import { cardSnippet } from "@features/library/snippet";

const DAY_MS = 86_400_000;
const TAG_SEARCH_DEBOUNCE_MS = 200;

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

type Row =
  | { kind: "rule"; key: string; label: string; count: number }
  | { kind: "card"; key: string; item: LibraryCardItem; index: number };

function bookmarkCard(b: SerializedBookmarkItem): LibraryCardItem {
  // A saved message names its sender and channel where other items show a snippet.
  const isMessage = b.type === "CHAT_MESSAGE";
  return {
    key: b.id,
    urn: b.urn,
    type: b.type,
    title: b.title,
    context: isMessage ? b.description : "",
    typeLabel: b.typeLabel,
    snippet: isMessage ? "" : cardSnippet(b.description),
    age: formatRelativeTime(b.createdAt),
    route: b.route,
    unavailable: b.availability === "available" ? undefined : b.availability,
  };
}

/** Rows for the list: a rule per save-time group, then its cards. Items arrive newest first. */
function bookmarkRows(items: SerializedBookmarkItem[]): Row[] {
  const now = new Date();
  const groups: { key: TimeGroupKey; items: SerializedBookmarkItem[] }[] = [];
  for (const item of items) {
    const key = timeGroupFor(item.createdAt, now);
    const last = groups[groups.length - 1];
    if (last?.key === key) last.items.push(item);
    else groups.push({ key, items: [item] });
  }
  const rows: Row[] = [];
  let index = 0;
  for (const group of groups) {
    rows.push({
      kind: "rule",
      key: `rule:${group.key}`,
      label: TIME_GROUPS[group.key],
      count: group.items.length,
    });
    for (const item of group.items) {
      rows.push({ kind: "card", key: item.id, item: bookmarkCard(item), index: index++ });
    }
  }
  return rows;
}

export function LibraryScreen({ initialTab }: { initialTab: LibraryTab }) {
  const T = useTheme();
  const insets = useSafeAreaInsets();
  const bottomPad =
    Platform.OS === "web" ? BOTTOM_NAV_HEIGHT + 34 : BOTTOM_NAV_HEIGHT + insets.bottom;
  const [tab, setTab] = useState<LibraryTab>(initialTab);
  // Each segment keeps its own ribbon selection; the rail and the tabs are
  // rendered once here so switching segments swaps only the list beneath them.
  const [bookmarkTypes, setBookmarkTypes] = useState<UrnType[]>([]);
  const [tagTypes, setTagTypes] = useState<UrnType[]>([]);

  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<SerializedTag | null>(null);
  // Bumped on every open so the editor remounts and seeds its fields from `tag`
  // on the first render. Closing leaves the key alone, keeping the fade-out.
  const [editorSession, setEditorSession] = useState(0);
  const openEditor = useCallback((tag: SerializedTag | null) => {
    setEditing(tag);
    setEditorSession((n) => n + 1);
    setEditorOpen(true);
  }, []);

  return (
    <View style={[styles.container, { backgroundColor: T.pageBg }]}>
      <DomainHeader
        title="Library"
        color={T.accent}
        icon="library"
        rightActions={
          tab === "tags" ? (
            <TouchableOpacity
              onPress={() => openEditor(null)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityLabel="New tag"
            >
              <Plus size={21} color={T.accent} weight="bold" />
            </TouchableOpacity>
          ) : undefined
        }
      />
      <View style={styles.body}>
        {tab === "bookmarks" ? (
          <RibbonRail
            types={BOOKMARK_FILTER_TYPES}
            selected={bookmarkTypes}
            onChange={setBookmarkTypes}
          />
        ) : (
          <RibbonRail types={TAG_FILTER_TYPES} selected={tagTypes} onChange={setTagTypes} />
        )}
        <LibraryTabs tab={tab} onChange={setTab} />
        {/* Both segments stay mounted: a switch shows the other list as it was,
            scroll position and all, instead of building it from scratch. */}
        <View style={tab === "bookmarks" ? styles.segment : styles.hiddenSegment}>
          <BookmarksSegment selected={bookmarkTypes} bottomPad={bottomPad} />
        </View>
        <View style={tab === "tags" ? styles.segment : styles.hiddenSegment}>
          <TagsSegment selected={tagTypes} bottomPad={bottomPad} onEdit={openEditor} />
        </View>
      </View>
      <TagEditorModal
        key={editorSession}
        visible={editorOpen}
        tag={editing}
        onClose={() => setEditorOpen(false)}
      />
    </View>
  );
}

interface SegmentProps {
  selected: UrnType[];
  bottomPad: number;
}

function BookmarksSegment({ selected, bottomPad }: SegmentProps) {
  const T = useTheme();
  const contentTypes = useMemo(() => toContentTypes(selected), [selected]);
  const bookmarks = useBookmarkItems(contentTypes);
  const unsave = useToggleBookmark().mutate;

  const items = useMemo(
    () => bookmarks.data?.pages.flatMap((page) => page.items) ?? [],
    [bookmarks.data],
  );
  const rows = useMemo(() => bookmarkRows(items), [items]);
  // A token-bearing empty page means more bookmarks sit behind a scan window of
  // revoked content; showing the empty state there would strand them.
  const isEmpty = !bookmarks.isLoading && items.length === 0 && !bookmarks.hasNextPage;

  const handleEndReached = useCallback(() => {
    if (bookmarks.hasNextPage && !bookmarks.isFetchingNextPage) bookmarks.fetchNextPage();
  }, [bookmarks]);

  const renderItem = useCallback(
    ({ item }: { item: Row }) =>
      item.kind === "rule" ? (
        <SectionRule label={item.label} count={item.count} />
      ) : (
        <LibraryCard
          item={item.item}
          index={item.index}
          onPress={() => {
            if (item.item.route) router.push(item.item.route as any);
          }}
          onRemove={() => unsave(item.item.urn)}
        />
      ),
    [unsave],
  );

  return (
    <>
      {bookmarks.isLoading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color={T.accent} />
        </View>
      ) : (
        <FlatList
          data={rows}
          renderItem={renderItem}
          keyExtractor={(row) => row.key}
          contentContainerStyle={[
            isEmpty ? styles.emptyContent : styles.listContent,
            { paddingBottom: bottomPad },
          ]}
          showsVerticalScrollIndicator={false}
          onEndReached={handleEndReached}
          onEndReachedThreshold={0.4}
          ListEmptyComponent={
            bookmarks.isError ? (
              <LoadFailed onRetry={() => bookmarks.refetch()} />
            ) : (
              <EmptyBookmarks filtered={selected.length > 0} />
            )
          }
          ListFooterComponent={
            bookmarks.isFetchingNextPage ? (
              <ActivityIndicator size="small" color={T.accent} style={styles.footerSpinner} />
            ) : null
          }
          refreshControl={
            <RefreshControl
              refreshing={bookmarks.isRefetching && !bookmarks.isFetchingNextPage}
              onRefresh={() => bookmarks.refetch()}
              tintColor={T.accent}
              colors={[T.accent]}
            />
          }
        />
      )}
    </>
  );
}

const GHOST_HEIGHTS = [40, 64, 48, 80, 56];
const GHOST_W = 28;

/** The empty state's row of ghost ribbons, one of them lit, as on the web. */
function GhostRibbons() {
  const T = useTheme();
  const tallest = Math.max(...GHOST_HEIGHTS);
  return (
    <View style={styles.ghosts} accessibilityElementsHidden importantForAccessibility="no">
      {GHOST_HEIGHTS.map((h, i) => (
        <Svg key={i} width={GHOST_W} height={tallest}>
          <Polygon
            points={`0,0 ${GHOST_W},0 ${GHOST_W},${h} ${GHOST_W / 2},${h - 7} 0,${h}`}
            fill={i === 3 ? withAlpha(T.accent, 0.35) : withAlpha(T.textDim, 0.18)}
          />
        </Svg>
      ))}
    </View>
  );
}

function EmptyBookmarks({ filtered }: { filtered: boolean }) {
  const T = useTheme();
  return (
    <View style={styles.emptyState}>
      <GhostRibbons />
      <Text style={[styles.emptyTitle, { color: T.textBright }]}>
        {filtered ? "No bookmarks match this filter" : "Nothing saved yet"}
      </Text>
      <Text style={[styles.emptySubtitle, { color: T.textDim }]}>
        {filtered
          ? "Try another type, or clear the filter to see everything you saved."
          : "Save a note, a file, a message, or an event anywhere in Uniffy and it will wait for you here."}
      </Text>
    </View>
  );
}

function TagsSegment({
  selected,
  bottomPad,
  onEdit,
}: SegmentProps & { onEdit: (tag: SerializedTag) => void }) {
  const T = useTheme();
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebouncedValue(query, TAG_SEARCH_DEBOUNCE_MS);
  const contentTypes = useMemo(() => toContentTypes(selected), [selected]);
  const tags = useTags(debouncedQuery, contentTypes);
  const removeTag = useTagMutations().remove.mutate;
  const data = tags.data ?? [];

  const confirmDelete = useCallback(
    (tag: SerializedTag) => {
      Alert.alert("Delete tag", `Remove "${tag.name}"? It will be unassigned from all content.`, [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () =>
            removeTag(tag.id, {
              onError: (error) =>
                Alert.alert("Could not delete", userFacingError(error, "The tag was not deleted.")),
            }),
        },
      ]);
    },
    [removeTag],
  );

  const showActions = useCallback(
    (tag: SerializedTag) => {
      Alert.alert(`#${tag.name}`, tag.description || undefined, [
        { text: "Edit", onPress: () => onEdit(tag) },
        { text: "Delete", style: "destructive", onPress: () => confirmDelete(tag) },
        { text: "Cancel", style: "cancel" },
      ]);
    },
    [onEdit, confirmDelete],
  );

  const open = useCallback((tag: SerializedTag) => {
    router.push({
      pathname: "/library/tags/[id]",
      params: {
        id: tag.id,
        name: tag.name,
        color: tag.color,
        count: String(tag.usageCount),
        description: tag.description,
      },
    } as any);
  }, []);

  return (
    <>
      <ScrollView
        contentContainerStyle={{ paddingBottom: bottomPad }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={tags.isFetching && !tags.isLoading}
            onRefresh={() => tags.refetch()}
            tintColor={T.accent}
            colors={[T.accent]}
          />
        }
      >
        <View style={styles.searchWrap}>
          <View style={[styles.searchRow, { backgroundColor: T.surface, borderColor: T.border }]}>
            <MagnifyingGlass size={15} color={T.textDim} weight="bold" />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search tags..."
              placeholderTextColor={T.textDim}
              style={[styles.searchInput, { color: T.textBright }]}
              autoCapitalize="none"
              autoCorrect={false}
            />
            {query.length > 0 && (
              <TouchableOpacity onPress={() => setQuery("")} hitSlop={8}>
                <X size={14} color={T.textDim} weight="bold" />
              </TouchableOpacity>
            )}
          </View>
        </View>

        <SectionRule label="All tags" count={data.length} />
        {tags.isLoading ? (
          <ActivityIndicator size="small" color={T.accent} style={styles.footerSpinner} />
        ) : tags.isError && data.length === 0 ? (
          <LoadFailed onRetry={() => tags.refetch()} />
        ) : data.length === 0 ? (
          <EmptyTags query={query} filtered={selected.length > 0} />
        ) : (
          <View style={styles.cloud}>
            {data.map((tag) => (
              <TagChip
                key={tag.id}
                tag={tag}
                onPress={() => open(tag)}
                onLongPress={() => showActions(tag)}
              />
            ))}
          </View>
        )}
      </ScrollView>
    </>
  );
}

function TagChip({
  tag,
  onPress,
  onLongPress,
}: {
  tag: SerializedTag;
  onPress: () => void;
  onLongPress: () => void;
}) {
  const T = useTheme();
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityRole="button"
      accessibilityLabel={`${tag.name}, ${tag.usageCount} items`}
      accessibilityHint="Long press to edit or delete"
      style={({ pressed }) => [
        styles.chip,
        { backgroundColor: withAlpha(tag.color, pressed ? 0.3 : T.isDark ? 0.2 : 0.14) },
      ]}
    >
      <Text style={[styles.chipName, { color: tag.color }]} numberOfLines={1}>
        #{tag.name}
      </Text>
      <Text style={[styles.chipCount, { color: tag.color }]}>{tag.usageCount}</Text>
    </Pressable>
  );
}

function EmptyTags({ query, filtered }: { query: string; filtered: boolean }) {
  const T = useTheme();
  const searching = query.trim().length > 0;
  return (
    <View style={styles.emptyState}>
      <TagIcon size={36} color={T.textDim} weight="duotone" />
      <Text style={[styles.emptyTitle, { color: T.textBright }]}>
        {searching || filtered ? "No matching tags" : "No tags yet"}
      </Text>
      <Text style={[styles.emptySubtitle, { color: T.textDim }]}>
        {searching || filtered
          ? "Try a different search, or clear the type filter."
          : "Create a tag to organize content across the workspace."}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  body: { flex: 1 },
  segment: { flex: 1 },
  hiddenSegment: { display: "none" },
  loadingWrap: { flex: 1, alignItems: "center", justifyContent: "center" },
  listContent: { paddingTop: 2 },
  emptyContent: { flexGrow: 1 },
  footerSpinner: { paddingVertical: 16 },
  searchWrap: { paddingHorizontal: 16, paddingTop: 10 },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    height: 40,
  },
  searchInput: { flex: 1, fontSize: 14, fontFamily: FONT.regular, paddingVertical: 0 },
  cloud: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    paddingHorizontal: 16,
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
    maxWidth: "100%",
  },
  chipName: { fontSize: 13, fontFamily: FONT.medium, flexShrink: 1 },
  chipCount: { fontSize: 11, fontFamily: FONT.regular, opacity: 0.75 },
  ghosts: { flexDirection: "row", alignItems: "flex-start", gap: 12, marginBottom: 8 },
  emptyState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingHorizontal: 40,
    paddingVertical: 32,
  },
  emptyTitle: { fontSize: 17, fontFamily: FONT.semibold, textAlign: "center" },
  emptySubtitle: { fontSize: 14, fontFamily: FONT.regular, textAlign: "center", lineHeight: 20 },
});
