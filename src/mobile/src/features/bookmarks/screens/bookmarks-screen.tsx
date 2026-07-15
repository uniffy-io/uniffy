import React, { useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  Platform,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { useQuery } from "@tanstack/react-query";
import { BookmarkSimple } from "phosphor-react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { DomainHeader } from "@shared/components/DomainHeader";
import { useTheme } from "@shared/hooks/useTheme";
import { BOTTOM_NAV_HEIGHT } from "@theme/theme";
import type { ThemeColors } from "@theme/theme";
import { FONT } from "@theme/typography";
import { useAuth } from "@core/providers/auth-context";
import { bookmarksApi } from "@features/bookmarks/bookmarksApi";
import { searchApi } from "@features/search/searchApi";
import { useToggleBookmark } from "@features/bookmarks/useBookmarks";
import { idFromUrn, typeToDomain, mobileRouteFor } from "@features/search/searchSerializer";
import type { Domain } from "@core/types";
import { DOMAIN_ICON } from "@shared/mentions/ReferenceChip";

interface BookmarkItem {
  urn: string;
  title: string;
  description: string;
  domain: Domain | null;
  route: string | null;
}

function useBookmarkItems() {
  const { organizationId, isAuthenticated } = useAuth();

  return useQuery({
    queryKey: ["bookmark-items", organizationId],
    enabled: !!organizationId && isAuthenticated,
    queryFn: async (): Promise<BookmarkItem[]> => {
      const listed = await bookmarksApi.listBookmarks({ organizationId: organizationId! });
      const urns = listed.bookmarks.map((b) => b.urn);
      if (urns.length === 0) return [];

      const resolved = await searchApi.resolveUrns({ organizationId: organizationId!, urns });
      // Preserve newest-first order from the bookmark list.
      return urns.map((urn) => {
        const meta = resolved.resolved[urn];
        const id = idFromUrn(urn);
        return {
          urn,
          title: meta?.title || "Untitled",
          description: meta?.description || "",
          domain: meta ? typeToDomain(meta.type) : null,
          route: meta ? mobileRouteFor(meta.type, id) : null,
        };
      });
    },
  });
}

export default function BookmarksScreen() {
  const T = useTheme();
  const insets = useSafeAreaInsets();
  const bottomPad =
    Platform.OS === "web" ? BOTTOM_NAV_HEIGHT + 34 : BOTTOM_NAV_HEIGHT + insets.bottom;
  const bookmarks = useBookmarkItems();
  const toggleBookmark = useToggleBookmark();

  const open = useCallback((item: BookmarkItem) => {
    if (item.route) router.push(item.route as any);
  }, []);

  const renderItem = useCallback(
    ({ item }: { item: BookmarkItem }) => (
      <BookmarkRow
        item={item}
        T={T}
        onPress={() => open(item)}
        onRemove={() => toggleBookmark.mutate(item.urn)}
      />
    ),
    [T, open, toggleBookmark],
  );

  const items = bookmarks.data ?? [];

  return (
    <View style={[styles.container, { backgroundColor: T.pageBg }]}>
      <DomainHeader title="Bookmarks" color={T.accent} icon="bookmark" />

      {bookmarks.isLoading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color={T.accent} />
        </View>
      ) : (
        <FlatList
          data={items}
          renderItem={renderItem}
          keyExtractor={(item) => item.urn}
          contentContainerStyle={[
            items.length === 0 ? styles.emptyContent : styles.listContent,
            { paddingBottom: bottomPad },
          ]}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={<EmptyBookmarks T={T} />}
          refreshControl={
            <RefreshControl
              refreshing={bookmarks.isFetching && !bookmarks.isLoading}
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
  item: BookmarkItem;
  T: ThemeColors;
  onPress: () => void;
  onRemove: () => void;
}) {
  const domain = (item.domain ?? "notes") as Domain;
  const Icon = DOMAIN_ICON[domain];
  return (
    <TouchableOpacity
      style={[styles.row, { borderBottomColor: T.border }]}
      onPress={onPress}
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
            <Text style={[styles.badgeText, { color: T.accent }]}>{domain.toUpperCase()}</Text>
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

function EmptyBookmarks({ T }: { T: ThemeColors }) {
  return (
    <View style={styles.emptyState}>
      <View style={[styles.emptyIconWrap, { backgroundColor: T.accentSoft }]}>
        <BookmarkSimple size={36} color={T.accent} weight="duotone" />
      </View>
      <Text style={[styles.emptyTitle, { color: T.textBright }]}>No bookmarks yet</Text>
      <Text style={[styles.emptySubtitle, { color: T.textDim }]}>
        Tap the bookmark icon on any note, file, or search result to save it here
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  loadingWrap: { flex: 1, alignItems: "center", justifyContent: "center" },
  listContent: { paddingBottom: 24 },
  emptyContent: { flexGrow: 1 },
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
  meta: { flexDirection: "row", alignItems: "center", gap: 6 },
  badge: { paddingHorizontal: 5, paddingVertical: 2, borderRadius: 4 },
  badgeText: { fontSize: 9, fontFamily: FONT.bold, letterSpacing: 0.4 },
  sub: { fontSize: 11, fontFamily: FONT.regular, flex: 1 },
  removeBtn: { padding: 4 },
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
