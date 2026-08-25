import React, { useCallback, useMemo, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  ScrollView,
  Platform,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { BookmarkSimple, LinkBreak } from "phosphor-react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ContentType } from "@uniffy/proto/common/v1/common_pb";
import { DomainHeader } from "@shared/components/DomainHeader";
import { useTheme } from "@shared/hooks/useTheme";
import { BOTTOM_NAV_HEIGHT } from "@theme/theme";
import type { ThemeColors } from "@theme/theme";
import { FONT } from "@theme/typography";
import { useBookmarkItems, useToggleBookmark } from "@features/bookmarks/useBookmarks";
import type { SerializedBookmarkItem } from "@features/bookmarks/bookmarksSerializer";
import type { Domain } from "@core/types";
import { DOMAIN_ICON } from "@shared/mentions/ReferenceChip";

const FILTERS: { key: string; label: string; types: ContentType[] }[] = [
  { key: "all", label: "All", types: [] },
  { key: "notes", label: "Notes", types: [ContentType.NOTE] },
  { key: "files", label: "Files", types: [ContentType.FILE, ContentType.FOLDER] },
  { key: "messages", label: "Messages", types: [ContentType.CHAT_MESSAGE] },
  { key: "events", label: "Events", types: [ContentType.CALENDAR_EVENT] },
  { key: "projects", label: "Projects", types: [ContentType.PROJECT, ContentType.TASK] },
  { key: "chats", label: "Chats", types: [ContentType.CHAT, ContentType.AGENT_CHAT] },
];

export function BookmarksScreen() {
  const T = useTheme();
  const insets = useSafeAreaInsets();
  const bottomPad =
    Platform.OS === "web" ? BOTTOM_NAV_HEIGHT + 34 : BOTTOM_NAV_HEIGHT + insets.bottom;

  const [filterKey, setFilterKey] = useState("all");
  const contentTypes = useMemo(
    () => FILTERS.find((f) => f.key === filterKey)?.types ?? [],
    [filterKey],
  );

  const bookmarks = useBookmarkItems(contentTypes);
  const toggleBookmark = useToggleBookmark();

  const items = useMemo(
    () => bookmarks.data?.pages.flatMap((page) => page.items) ?? [],
    [bookmarks.data],
  );

  const open = useCallback((item: SerializedBookmarkItem) => {
    if (item.route) router.push(item.route as any);
  }, []);

  const handleEndReached = useCallback(() => {
    if (bookmarks.hasNextPage && !bookmarks.isFetchingNextPage) {
      bookmarks.fetchNextPage();
    }
  }, [bookmarks]);

  const renderItem = useCallback(
    ({ item }: { item: SerializedBookmarkItem }) => (
      <BookmarkRow
        item={item}
        T={T}
        onPress={() => open(item)}
        onRemove={() => toggleBookmark.mutate(item.urn)}
      />
    ),
    [T, open, toggleBookmark],
  );

  return (
    <View style={[styles.container, { backgroundColor: T.pageBg }]}>
      <DomainHeader title="Bookmarks" color={T.accent} icon="bookmark" />

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={[styles.filterBar, { borderBottomColor: T.border }]}
        contentContainerStyle={styles.filterBarContent}
      >
        {FILTERS.map((f) => {
          const active = filterKey === f.key;
          return (
            <TouchableOpacity
              key={f.key}
              style={[
                styles.filterPill,
                {
                  backgroundColor: active ? T.accent + "22" : T.surface,
                  borderColor: active ? T.accent : T.border,
                },
              ]}
              onPress={() => setFilterKey(f.key)}
              activeOpacity={0.7}
            >
              <Text style={[styles.filterText, { color: active ? T.accent : T.textDim }]}>
                {f.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {bookmarks.isLoading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color={T.accent} />
        </View>
      ) : (
        <FlatList
          data={items}
          renderItem={renderItem}
          keyExtractor={(item) => item.id}
          contentContainerStyle={[
            items.length === 0 ? styles.emptyContent : styles.listContent,
            { paddingBottom: bottomPad },
          ]}
          showsVerticalScrollIndicator={false}
          onEndReached={handleEndReached}
          onEndReachedThreshold={0.4}
          ListEmptyComponent={<EmptyBookmarks T={T} filtered={filterKey !== "all"} />}
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
    </View>
  );
}

function BookmarkRow({
  item,
  T,
  onPress,
  onRemove,
}: {
  item: SerializedBookmarkItem;
  T: ThemeColors;
  onPress: () => void;
  onRemove: () => void;
}) {
  if (item.availability !== "available") {
    const deleted = item.availability === "deleted";
    return (
      <View style={[styles.row, { borderBottomColor: T.border }]}>
        <View style={[styles.icon, { backgroundColor: T.surface }]}>
          <LinkBreak size={16} color={T.textDim} weight="duotone" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.unavailableTitle, { color: T.textDim }]} numberOfLines={1}>
            {deleted ? "This item was deleted" : "This item is unavailable"}
          </Text>
        </View>
        <TouchableOpacity
          onPress={onRemove}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          style={styles.removeBtn}
        >
          <Text style={[styles.removeText, { color: T.textDim }]}>Remove</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const domain = (item.domain ?? "notes") as Domain;
  const Icon = DOMAIN_ICON[domain];
  const canOpen = item.route !== null;

  return (
    <TouchableOpacity
      style={[styles.row, { borderBottomColor: T.border }]}
      onPress={onPress}
      disabled={!canOpen}
      activeOpacity={0.7}
    >
      <View style={[styles.icon, { backgroundColor: T.accentSoft }]}>
        <Icon size={16} color={T.accent} weight="bold" />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.title, { color: T.textBright }]} numberOfLines={1}>
          {item.title}
        </Text>
        <View style={styles.meta}>
          <View style={[styles.badge, { backgroundColor: T.accentSoft }]}>
            <Text style={[styles.badgeText, { color: T.accent }]}>
              {item.typeLabel.toUpperCase()}
            </Text>
          </View>
          {item.description ? (
            <Text style={[styles.sub, { color: T.textDim }]} numberOfLines={1}>
              {item.description}
            </Text>
          ) : null}
        </View>
      </View>
      <TouchableOpacity
        onPress={onRemove}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        style={styles.removeBtn}
      >
        <BookmarkSimple size={18} color={T.accent} weight="fill" />
      </TouchableOpacity>
    </TouchableOpacity>
  );
}

function EmptyBookmarks({ T, filtered }: { T: ThemeColors; filtered: boolean }) {
  return (
    <View style={styles.emptyState}>
      <View style={[styles.emptyIconWrap, { backgroundColor: T.accentSoft }]}>
        <BookmarkSimple size={36} color={T.accent} weight="duotone" />
      </View>
      <Text style={[styles.emptyTitle, { color: T.textBright }]}>
        {filtered ? "No bookmarks of this type" : "No bookmarks yet"}
      </Text>
      <Text style={[styles.emptySubtitle, { color: T.textDim }]}>
        {filtered
          ? "Try another type, or clear the filter to see everything you saved"
          : "Tap the bookmark icon on any note, file, or search result to save it here"}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  loadingWrap: { flex: 1, alignItems: "center", justifyContent: "center" },
  listContent: { paddingBottom: 24 },
  emptyContent: { flexGrow: 1 },
  filterBar: { flexGrow: 0, borderBottomWidth: StyleSheet.hairlineWidth },
  filterBarContent: { paddingHorizontal: 16, paddingVertical: 8, gap: 8 },
  filterPill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
  },
  filterText: { fontSize: 12, fontFamily: FONT.medium },
  footerSpinner: { paddingVertical: 16 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  icon: { width: 38, height: 38, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 14, fontFamily: FONT.medium, marginBottom: 4 },
  unavailableTitle: { fontSize: 13, fontFamily: FONT.regular, fontStyle: "italic" },
  meta: { flexDirection: "row", alignItems: "center", gap: 6 },
  badge: { paddingHorizontal: 5, paddingVertical: 2, borderRadius: 4 },
  badgeText: { fontSize: 9, fontFamily: FONT.bold, letterSpacing: 0.4 },
  sub: { fontSize: 11, fontFamily: FONT.regular, flex: 1 },
  removeBtn: { padding: 4 },
  removeText: { fontSize: 12, fontFamily: FONT.medium },
  emptyState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    paddingHorizontal: 40,
  },
  emptyIconWrap: {
    width: 76,
    height: 76,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  emptyTitle: { fontSize: 17, fontFamily: FONT.semibold },
  emptySubtitle: { fontSize: 14, fontFamily: FONT.regular, textAlign: "center", lineHeight: 20 },
});
