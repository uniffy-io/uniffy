import React, { useCallback } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Platform,
  RefreshControl,
} from "react-native";
import { router, useLocalSearchParams, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Phone, CaretRight } from "phosphor-react-native";
import { DomainHeader } from "@shared/components/DomainHeader";
import { useTheme } from "@shared/hooks/useTheme";
import { BOTTOM_NAV_HEIGHT } from "@theme/theme";
import { FONT } from "@theme/typography";
import { useCallHistory } from "@features/calls/useCallHistory";
import { callDuration } from "@features/calls/historySerializer";
import { formatCallStart } from "@features/calls/historyFormat";

export function CallHistoryScreen() {
  const T = useTheme();
  const insets = useSafeAreaInsets();
  const bottomPad =
    Platform.OS === "web" ? BOTTOM_NAV_HEIGHT + 34 : BOTTOM_NAV_HEIGHT + insets.bottom;
  const { channelId } = useLocalSearchParams<{ channelId?: string }>();
  const history = useCallHistory(channelId);
  const { refetch, hasNextPage, isFetchingNextPage, fetchNextPage } = history;
  useFocusEffect(
    useCallback(() => {
      void refetch();
    }, [refetch]),
  );
  const loadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  return (
    <View style={[styles.screen, { backgroundColor: T.pageBg }]}>
      <DomainHeader
        title="Call history"
        subtitle={channelId ? "Conversation calls" : "Your calls"}
        icon="chat"
        color={T.accent}
        onBack={() => (router.canGoBack() ? router.back() : router.replace("/chat"))}
      />
      {history.isPending ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color={T.accent} />
        </View>
      ) : history.isError ? (
        <View style={styles.loadingWrap}>
          <Text style={[styles.empty, { color: T.textDim }]}>Call history unavailable.</Text>
          <TouchableOpacity
            accessibilityRole="button"
            activeOpacity={0.7}
            onPress={() => void refetch()}
            style={styles.retry}
          >
            <Text style={[styles.retryLabel, { color: T.accent }]}>Try again</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={history.data?.pages.flatMap((page) => page.records) ?? []}
          keyExtractor={(item) => item.id}
          contentContainerStyle={[styles.list, { paddingBottom: bottomPad }]}
          onEndReached={loadMore}
          onEndReachedThreshold={0.4}
          refreshControl={
            <RefreshControl
              refreshing={history.isRefetching && !isFetchingNextPage}
              onRefresh={() => void refetch()}
              tintColor={T.accent}
              colors={[T.accent]}
            />
          }
          renderItem={({ item }) => (
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={`Open call ${item.title}`}
              activeOpacity={0.7}
              onPress={() => router.push(`/calls/${item.id}`)}
              style={[styles.row, { borderBottomColor: T.border }]}
            >
              <Phone size={20} color={T.accent} />
              <View style={styles.main}>
                <Text numberOfLines={1} style={[styles.title, { color: T.textBright }]}>
                  {item.title}
                </Text>
                <Text style={[styles.caption, { color: T.textDim }]}>
                  {formatCallStart(item.startedAt)}
                </Text>
              </View>
              <View style={styles.meta}>
                <Text style={[styles.caption, { color: T.text }]}>
                  {item.outcome === "Missed" || item.outcome === "Declined"
                    ? item.outcome
                    : callDuration(item)}
                </Text>
                <Text style={[styles.caption, { color: T.textDim }]}>
                  {item.participantCount} joined
                </Text>
              </View>
              <CaretRight size={15} color={T.textDim} weight="regular" />
            </TouchableOpacity>
          )}
          ListEmptyComponent={
            <Text style={[styles.empty, { color: T.textDim }]}>
              No calls yet. Calls you start, join or receive will appear here.
            </Text>
          }
          ListFooterComponent={
            isFetchingNextPage ? (
              <ActivityIndicator size="small" color={T.accent} style={styles.footerSpinner} />
            ) : null
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  loadingWrap: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  list: { paddingHorizontal: 16, paddingTop: 8 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 18,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  main: { flex: 1, minWidth: 0 },
  meta: { alignItems: "flex-end" },
  title: { fontFamily: FONT.medium, fontSize: 15 },
  caption: { fontFamily: FONT.regular, fontSize: 12, marginTop: 4 },
  empty: { fontFamily: FONT.regular, fontSize: 14, padding: 24, textAlign: "center" },
  retry: { minHeight: 44, justifyContent: "center", paddingHorizontal: 12 },
  retryLabel: { fontFamily: FONT.semibold, fontSize: 14 },
  footerSpinner: { paddingVertical: 16 },
});
