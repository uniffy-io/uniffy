import React, { useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { Tag as TagIcon } from "phosphor-react-native";
import { DomainHeader } from "@shared/components/DomainHeader";
import { useTheme } from "@shared/hooks/useTheme";
import type { ThemeColors } from "@theme/theme";
import { FONT } from "@theme/typography";
import { useTagContent } from "@features/tags/useTags";
import type { SerializedTaggedItem } from "@features/tags/tagSerializer";
import type { Domain } from "@core/types";
import { DOMAIN_ICON } from "@shared/mentions/ReferenceChip";

export default function TagContentScreen() {
  const T = useTheme();
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();
  const content = useTagContent(id);

  const open = useCallback((item: SerializedTaggedItem) => {
    if (item.route) router.push(item.route as any);
  }, []);

  const renderItem = useCallback(
    ({ item }: { item: SerializedTaggedItem }) => (
      <ContentRow item={item} T={T} onPress={() => open(item)} />
    ),
    [T, open],
  );

  const data = content.data ?? [];

  return (
    <View style={[styles.container, { backgroundColor: T.pageBg }]}>
      <DomainHeader
        title={name ? `#${name}` : "Tag"}
        subtitle={data.length > 0 ? `${data.length} items` : undefined}
        color={T.accent}
        icon="tag"
      />

      {content.isLoading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color={T.accent} />
        </View>
      ) : (
        <FlatList
          data={data}
          renderItem={renderItem}
          keyExtractor={(item) => item.urn}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={data.length === 0 ? styles.emptyContent : styles.listContent}
          ListEmptyComponent={
            <View style={styles.empty}>
              <TagIcon size={34} color={T.accent} weight="duotone" />
              <Text style={[styles.emptyText, { color: T.textDim }]}>Nothing tagged yet</Text>
            </View>
          }
          refreshControl={
            <RefreshControl
              refreshing={content.isFetching && !content.isLoading}
              onRefresh={() => content.refetch()}
              tintColor={T.accent}
              colors={[T.accent]}
            />
          }
        />
      )}
    </View>
  );
}

function ContentRow({
  item,
  T,
  onPress,
}: {
  item: SerializedTaggedItem;
  T: ThemeColors;
  onPress: () => void;
}) {
  const domain = (item.domain ?? "notes") as Domain;
  const Icon = DOMAIN_ICON[domain];
  const domainColor = T.domains[domain];
  const softColor = T.domains[`${domain}Soft`];
  return (
    <TouchableOpacity
      style={[styles.row, { borderBottomColor: T.border }]}
      onPress={onPress}
      disabled={!item.route}
      activeOpacity={0.7}
    >
      <View style={[styles.icon, { backgroundColor: softColor }]}>
        <Icon size={16} color={domainColor} weight="bold" />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.title, { color: T.textBright }]} numberOfLines={1}>
          {item.title}
        </Text>
        {item.snippet ? (
          <Text style={[styles.snippet, { color: T.textDim }]} numberOfLines={1}>
            {item.snippet}
          </Text>
        ) : null}
      </View>
      <View style={[styles.badge, { backgroundColor: softColor }]}>
        <Text style={[styles.badgeText, { color: domainColor }]}>{domain.toUpperCase()}</Text>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  loadingWrap: { flex: 1, alignItems: "center", justifyContent: "center" },
  listContent: { paddingBottom: 24 },
  emptyContent: { flexGrow: 1 },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10, padding: 40 },
  emptyText: { fontSize: 14, fontFamily: FONT.regular },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  icon: { width: 38, height: 38, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 14, fontFamily: FONT.medium },
  snippet: { fontSize: 12, fontFamily: FONT.regular, marginTop: 2 },
  badge: { paddingHorizontal: 5, paddingVertical: 2, borderRadius: 4 },
  badgeText: { fontSize: 9, fontFamily: FONT.bold, letterSpacing: 0.4 },
});
