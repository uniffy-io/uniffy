import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  Platform,
  ScrollView,
  ActivityIndicator,
  Keyboard,
} from "react-native";
import { MagnifyingGlass, X, BookmarkSimple, Tag as TagIcon } from "phosphor-react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { DomainHeader } from "@shared/components/DomainHeader";
import { useTheme } from "@shared/hooks/useTheme";
import { BOTTOM_NAV_HEIGHT } from "@theme/theme";
import type { ThemeColors } from "@theme/theme";
import { FONT } from "@theme/typography";
import { useAuth } from "@core/providers/AuthContext";
import { searchApi } from "@features/search/searchApi";
import { bookmarksApi } from "@features/bookmarks/bookmarksApi";
import { useToggleBookmark } from "@features/bookmarks/useBookmarks";
import { searchResultToPlain } from "@features/search/searchSerializer";
import type { SerializedSearchResult } from "@features/search/searchSerializer";
import { parseSearchQuery } from "@features/search/searchQuery";
import { SearchResultType } from "@uniffy/proto/search/v1/search_pb";
import type { Domain } from "@core/types";
import { DOMAIN_ICON } from "@shared/mentions/ReferenceChip";

const DEBOUNCE_MS = 220;

const FILTERS: { key: "all" | Domain; label: string; types: SearchResultType[] }[] = [
  { key: "all", label: "All", types: [] },
  { key: "notes", label: "Notes", types: [SearchResultType.NOTE] },
  { key: "files", label: "Files", types: [SearchResultType.FILE] },
  { key: "chat", label: "Chat", types: [SearchResultType.CHAT] },
  { key: "calendar", label: "Calendar", types: [SearchResultType.CALENDAR_EVENT] },
  {
    key: "projects",
    label: "Projects",
    types: [SearchResultType.PROJECT, SearchResultType.TASK],
  },
];

export function SearchScreen() {
  const T = useTheme();
  const insets = useSafeAreaInsets();
  const bottomPad =
    Platform.OS === "web" ? BOTTOM_NAV_HEIGHT + 34 : BOTTOM_NAV_HEIGHT + insets.bottom;
  const { organizationId } = useAuth();
  const toggleBookmark = useToggleBookmark();

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SerializedSearchResult[]>([]);
  const [bookmarked, setBookmarked] = useState<Record<string, boolean>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [filter, setFilter] = useState<"all" | Domain>("all");

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<TextInput>(null);

  const parsed = useMemo(() => parseSearchQuery(query), [query]);

  const runSearch = useCallback(
    async (raw: string, activeFilter: "all" | Domain) => {
      const p = parseSearchQuery(raw);
      if (!p.text.trim() && p.types.length === 0 && p.tags.length === 0) {
        setResults([]);
        setIsLoading(false);
        return;
      }
      if (!organizationId) return;

      abortRef.current?.abort();
      abortRef.current = new AbortController();
      setIsLoading(true);

      const chipTypes = FILTERS.find((f) => f.key === activeFilter)?.types ?? [];
      const typeFilters = Array.from(new Set([...p.types, ...chipTypes]));

      try {
        const response = await searchApi.search({
          organizationId,
          query: p.text,
          typeFilters,
          tagFilters: p.tags,
          myContentOnly: p.myContentOnly,
          limit: 40,
        });
        const serialized = response.items.map(searchResultToPlain);
        setResults(serialized);

        const urns = serialized.map((r) => r.urn);
        if (urns.length > 0) {
          bookmarksApi
            .bulkCheckBookmarks({ organizationId, urns })
            .then((res) => setBookmarked(res.bookmarkedUrns))
            .catch(() => {});
        }
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return;
        setResults([]);
      } finally {
        setIsLoading(false);
      }
    },
    [organizationId],
  );

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runSearch(query, filter), DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, filter, runSearch]);

  const handleToggleBookmark = useCallback(
    (urn: string) => {
      setBookmarked((prev) => ({ ...prev, [urn]: !prev[urn] }));
      toggleBookmark.mutate(urn);
    },
    [toggleBookmark],
  );

  const openResult = useCallback((item: SerializedSearchResult) => {
    Keyboard.dismiss();
    if (item.route) router.push(item.route as any);
  }, []);

  const renderItem = useCallback(
    ({ item }: { item: SerializedSearchResult }) => (
      <ResultRow
        item={item}
        T={T}
        bookmarked={!!bookmarked[item.urn]}
        onPress={() => openResult(item)}
        onBookmark={() => handleToggleBookmark(item.urn)}
      />
    ),
    [T, bookmarked, openResult, handleToggleBookmark],
  );

  const showFilterHint = parsed.tags.length > 0 || parsed.myContentOnly;

  return (
    <View style={[styles.container, { backgroundColor: T.pageBg }]}>
      <DomainHeader
        title="Search"
        color={T.accent}
        icon="search"
        rightActions={
          <TouchableOpacity
            onPress={() => router.push("/tags" as any)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <TagIcon size={20} color={T.text} weight="duotone" />
          </TouchableOpacity>
        }
      />

      <View style={[styles.searchBarWrap, { borderBottomColor: T.border }]}>
        <View style={[styles.searchRow, { backgroundColor: T.surface, borderColor: T.border }]}>
          <MagnifyingGlass size={17} color={T.textDim} weight="bold" />
          <TextInput
            ref={inputRef}
            style={[styles.input, { color: T.textBright }]}
            placeholder="Search everything... (try type:note tag:design)"
            placeholderTextColor={T.textDim}
            value={query}
            onChangeText={setQuery}
            autoFocus
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
          />
          {query.length > 0 && (
            <TouchableOpacity
              onPress={() => setQuery("")}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <X size={15} color={T.textDim} weight="bold" />
            </TouchableOpacity>
          )}
        </View>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={[styles.filterBar, { borderBottomColor: T.border }]}
        contentContainerStyle={styles.filterBarContent}
      >
        {FILTERS.map((f) => {
          const active = filter === f.key;
          const color = T.accent;
          return (
            <TouchableOpacity
              key={f.key}
              style={[
                styles.filterPill,
                {
                  backgroundColor: active ? color + "22" : T.surface,
                  borderColor: active ? color : T.border,
                },
              ]}
              onPress={() => setFilter(f.key)}
              activeOpacity={0.7}
            >
              <Text style={[styles.filterText, { color: active ? color : T.textDim }]}>
                {f.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {showFilterHint && (
        <View style={[styles.hintRow, { backgroundColor: T.surface }]}>
          {parsed.myContentOnly && (
            <View style={[styles.hintChip, { backgroundColor: T.accentSoft }]}>
              <Text style={[styles.hintChipText, { color: T.accent }]}>my content</Text>
            </View>
          )}
          {parsed.tags.map((tag) => (
            <View key={tag} style={[styles.hintChip, { backgroundColor: T.accentSoft }]}>
              <Text style={[styles.hintChipText, { color: T.accent }]}>#{tag}</Text>
            </View>
          ))}
        </View>
      )}

      <FlatList
        data={results}
        renderItem={renderItem}
        keyExtractor={(item) => item.urn}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[
          results.length === 0 ? styles.emptyContent : styles.listContent,
          { paddingBottom: bottomPad },
        ]}
        ListEmptyComponent={
          isLoading ? (
            <View style={styles.empty}>
              <ActivityIndicator color={T.accent} />
            </View>
          ) : (
            <View style={styles.empty}>
              <Text style={[styles.emptyText, { color: T.textDim }]}>
                {query.trim() ? "No results found" : "Type to search across everything"}
              </Text>
            </View>
          )
        }
      />
    </View>
  );
}

function ResultRow({
  item,
  T,
  bookmarked,
  onPress,
  onBookmark,
}: {
  item: SerializedSearchResult;
  T: ThemeColors;
  bookmarked: boolean;
  onPress: () => void;
  onBookmark: () => void;
}) {
  const domain = (item.domain ?? "notes") as Domain;
  const Icon = DOMAIN_ICON[domain];
  return (
    <TouchableOpacity
      style={[styles.resultRow, { borderBottomColor: T.border }]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={[styles.domainIcon, { backgroundColor: T.accentSoft }]}>
        <Icon size={16} color={T.accent} weight="bold" />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.resultTitle, { color: T.textBright }]} numberOfLines={1}>
          {item.title}
        </Text>
        <View style={styles.resultMeta}>
          <View style={[styles.domainBadge, { backgroundColor: T.accentSoft }]}>
            <Text style={[styles.domainBadgeText, { color: T.accent }]}>
              {domain.toUpperCase()}
            </Text>
          </View>
          {item.description ? (
            <Text style={[styles.resultSub, { color: T.textDim }]} numberOfLines={1}>
              {item.description}
            </Text>
          ) : null}
        </View>
      </View>
      <TouchableOpacity
        onPress={onBookmark}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        style={styles.bookmarkBtn}
      >
        <BookmarkSimple
          key={bookmarked ? "fill" : "regular"}
          size={18}
          color={bookmarked ? T.accent : T.textDim}
          weight={bookmarked ? "fill" : "regular"}
        />
      </TouchableOpacity>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  searchBarWrap: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    height: 44,
  },
  input: {
    flex: 1,
    fontSize: 15,
    fontFamily: FONT.regular,
    paddingVertical: 0,
    includeFontPadding: false,
  },
  filterBar: { flexGrow: 0, borderBottomWidth: StyleSheet.hairlineWidth },
  filterBarContent: { paddingHorizontal: 16, gap: 8, paddingVertical: 10, flexDirection: "row" },
  filterPill: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 20, borderWidth: 1 },
  filterText: { fontSize: 12, fontFamily: FONT.medium },
  hintRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  hintChip: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  hintChipText: { fontSize: 11, fontFamily: FONT.semibold },
  listContent: { paddingBottom: 24 },
  emptyContent: { flexGrow: 1 },
  resultRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  domainIcon: {
    width: 38,
    height: 38,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  resultTitle: { fontSize: 14, fontFamily: FONT.medium, marginBottom: 4 },
  resultMeta: { flexDirection: "row", alignItems: "center", gap: 6 },
  domainBadge: { paddingHorizontal: 5, paddingVertical: 2, borderRadius: 4 },
  domainBadgeText: { fontSize: 9, fontFamily: FONT.bold, letterSpacing: 0.4 },
  resultSub: { fontSize: 11, fontFamily: FONT.regular, flex: 1 },
  bookmarkBtn: { padding: 4 },
  empty: { flex: 1, padding: 40, alignItems: "center", justifyContent: "center" },
  emptyText: { fontSize: 15, fontFamily: FONT.regular, textAlign: "center" },
});
