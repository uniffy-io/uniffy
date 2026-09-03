import React, { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Platform,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { Tag as TagIcon } from "phosphor-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { DomainHeader } from "@shared/components/DomainHeader";
import { ScreenError } from "@shared/components/ScreenError";
import { useTheme } from "@shared/hooks/useTheme";
import { BOTTOM_NAV_HEIGHT } from "@theme/theme";
import { FONT } from "@theme/typography";
import { withAlpha } from "@theme/brandRamp";
import { formatRelativeTime } from "@shared/lib/dateFormatting";
import type { UrnType } from "@shared/lib/contentTypes";
import { useTagContent } from "@features/tags/useTags";
import { tagColorOrDefault, type SerializedTaggedItem } from "@features/tags/tagSerializer";
import { LIBRARY_TYPES, TAG_FILTER_TYPES, toContentTypes } from "@features/library/libraryTypes";
import { RibbonRail } from "@features/library/components/RibbonRail";
import { SectionRule } from "@features/library/components/SectionRule";
import { LibraryCard, type LibraryCardItem } from "@features/library/components/LibraryCard";
import { cardSnippet } from "@features/library/snippet";

type Row =
  | { kind: "rule"; key: string; label: string; count: number }
  | { kind: "card"; key: string; item: LibraryCardItem; index: number };

function taggedCard(item: SerializedTaggedItem): LibraryCardItem {
  return {
    key: item.urn,
    urn: item.urn,
    type: item.type,
    title: item.title,
    context: "",
    snippet: cardSnippet(item.snippet),
    age: formatRelativeTime(item.updatedAt),
    route: item.route,
  };
}

/** Rows grouped by type, the largest group first, as on the web. */
function taggedRows(items: SerializedTaggedItem[]): Row[] {
  const buckets = new Map<UrnType | null, SerializedTaggedItem[]>();
  for (const item of items) {
    const bucket = buckets.get(item.type) ?? [];
    bucket.push(item);
    buckets.set(item.type, bucket);
  }
  const groups = [...buckets.entries()].sort((a, b) => b[1].length - a[1].length);
  const rows: Row[] = [];
  let index = 0;
  for (const [type, groupItems] of groups) {
    rows.push({
      kind: "rule",
      key: `rule:${type ?? "other"}`,
      label: type ? LIBRARY_TYPES[type].labelPlural : "Other",
      count: groupItems.length,
    });
    for (const item of groupItems) {
      rows.push({ kind: "card", key: item.urn, item: taggedCard(item), index: index++ });
    }
  }
  return rows;
}

export function TagContentScreen() {
  const T = useTheme();
  const insets = useSafeAreaInsets();
  const bottomPad =
    Platform.OS === "web" ? BOTTOM_NAV_HEIGHT + 34 : BOTTOM_NAV_HEIGHT + insets.bottom;
  const { id, name, color, count, description } = useLocalSearchParams<{
    id: string;
    name?: string;
    color?: string;
    count?: string;
    description?: string;
  }>();
  const [selected, setSelected] = useState<UrnType[]>([]);
  const contentTypes = useMemo(() => toContentTypes(selected), [selected]);
  const content = useTagContent(id, contentTypes);

  const items = useMemo(
    () => content.data?.pages.flatMap((page) => page.items) ?? [],
    [content.data],
  );
  const rows = useMemo(() => taggedRows(items), [items]);
  // The name, colour, and count ride in on the route, so a deep link can carry
  // anything: the colour is checked before it is parsed and the count before it
  // is shown, and only the server decides whether the tag's content exists.
  const tagColor = tagColorOrDefault(color);
  const knownCount = count ? Number(count) : NaN;
  const hasKnownCount = Number.isFinite(knownCount);
  const total = hasKnownCount ? knownCount : items.length;

  const handleEndReached = useCallback(() => {
    if (content.hasNextPage && !content.isFetchingNextPage) content.fetchNextPage();
  }, [content]);

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
        />
      ),
    [],
  );

  if (content.isError && !content.data) {
    return (
      <ScreenError
        title={name ? `#${name}` : "Tag"}
        icon="tag"
        color={T.accent}
        onRetry={() => content.refetch()}
      />
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: T.pageBg }]}>
      <DomainHeader
        title={name ? `#${name}` : "Tag"}
        subtitle={hasKnownCount ? `${total} item${total === 1 ? "" : "s"}` : undefined}
        color={T.accent}
        icon="tag"
      />
      <View style={styles.body}>
        <RibbonRail types={TAG_FILTER_TYPES} selected={selected} onChange={setSelected} />
        {content.isLoading ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator size="large" color={T.accent} />
          </View>
        ) : (
          <FlatList
            data={rows}
            renderItem={renderItem}
            keyExtractor={(row) => row.key}
            ListHeaderComponent={
              <View style={styles.summary}>
                <View style={styles.summaryRow}>
                  <View style={[styles.chip, { backgroundColor: withAlpha(tagColor, 0.2) }]}>
                    <Text style={[styles.chipText, { color: tagColor }]} numberOfLines={1}>
                      #{name}
                    </Text>
                  </View>
                  <Text style={[styles.summaryName, { color: T.textBright }]} numberOfLines={1}>
                    {name}
                  </Text>
                  <Text style={[styles.summaryCount, { color: T.textDim }]}>
                    {total} item{total === 1 ? "" : "s"}
                  </Text>
                </View>
                {description ? (
                  <Text style={[styles.summaryDescription, { color: T.textDim }]}>
                    {description}
                  </Text>
                ) : null}
              </View>
            }
            contentContainerStyle={[
              rows.length === 0 ? styles.emptyContent : null,
              { paddingBottom: bottomPad },
            ]}
            showsVerticalScrollIndicator={false}
            onEndReached={handleEndReached}
            onEndReachedThreshold={0.4}
            ListEmptyComponent={
              <View style={styles.empty}>
                <TagIcon size={34} color={T.textDim} weight="duotone" />
                <Text style={[styles.emptyText, { color: T.textDim }]}>
                  {selected.length > 0
                    ? "No content matches the current filter."
                    : "Nothing tagged yet"}
                </Text>
              </View>
            }
            ListFooterComponent={
              content.isFetchingNextPage ? (
                <ActivityIndicator size="small" color={T.accent} style={styles.footerSpinner} />
              ) : null
            }
            refreshControl={
              <RefreshControl
                refreshing={content.isRefetching && !content.isFetchingNextPage}
                onRefresh={() => content.refetch()}
                tintColor={T.accent}
                colors={[T.accent]}
              />
            }
          />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  body: { flex: 1 },
  loadingWrap: { flex: 1, alignItems: "center", justifyContent: "center" },
  emptyContent: { flexGrow: 1 },
  footerSpinner: { paddingVertical: 16 },
  summary: { paddingHorizontal: 16, paddingTop: 12, gap: 6 },
  summaryRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  chip: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, maxWidth: "50%" },
  chipText: { fontSize: 12, fontFamily: FONT.medium },
  summaryName: { fontSize: 14, fontFamily: FONT.semibold, flexShrink: 1 },
  summaryCount: { fontSize: 12, fontFamily: FONT.regular },
  summaryDescription: { fontSize: 12, fontFamily: FONT.regular },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10, padding: 40 },
  emptyText: { fontSize: 14, fontFamily: FONT.regular, textAlign: "center" },
});
