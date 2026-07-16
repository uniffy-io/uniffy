import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  Platform,
  ActivityIndicator,
  RefreshControl,
  Alert,
} from "react-native";
import {
  ShareNetwork,
  At,
  PencilSimple,
  CalendarBlank,
  Kanban,
  ChatCircle,
  Key,
  Megaphone,
  BellSimple,
  Checks,
} from "phosphor-react-native";
import type { IconProps } from "phosphor-react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { DomainHeader } from "@shared/components/DomainHeader";
import { Avatar } from "@shared/components/Avatar";
import { useTheme } from "@shared/hooks/useTheme";
import { BOTTOM_NAV_HEIGHT } from "@theme/theme";
import type { ThemeColors } from "@theme/theme";
import { FONT } from "@theme/typography";
import {
  useNotifications,
  useMarkNotificationRead,
  useMarkAllNotificationsRead,
  useDeleteNotification,
} from "@features/notifications/useNotifications";
import type {
  NotificationIconKind,
  SerializedNotification,
} from "@features/notifications/notificationSerializer";

const ICON_MAP: Record<NotificationIconKind, React.ComponentType<IconProps>> = {
  share: ShareNetwork,
  mention: At,
  edit: PencilSimple,
  calendar: CalendarBlank,
  task: Kanban,
  chat: ChatCircle,
  permission: Key,
  system: Megaphone,
};

type Tab = "all" | "unread";

export function NotificationsScreen() {
  const T = useTheme();
  const insets = useSafeAreaInsets();
  const bottomPad =
    Platform.OS === "web" ? BOTTOM_NAV_HEIGHT + 34 : BOTTOM_NAV_HEIGHT + insets.bottom;
  const [tab, setTab] = useState<Tab>("all");
  const feed = useNotifications(tab === "unread");
  const markRead = useMarkNotificationRead();
  const markAllRead = useMarkAllNotificationsRead();
  const deleteNotification = useDeleteNotification();

  const data = feed.data?.notifications ?? [];
  const unreadCount = feed.data?.unreadCount ?? 0;

  const handlePress = useCallback(
    (item: SerializedNotification) => {
      if (!item.isRead) markRead.mutate(item.id);
      if (item.route) router.push(item.route as any);
    },
    [markRead],
  );

  const handleLongPress = useCallback(
    (item: SerializedNotification) => {
      Alert.alert(item.title || "Notification", undefined, [
        ...(!item.isRead
          ? [{ text: "Mark as read", onPress: () => markRead.mutate(item.id) }]
          : []),
        {
          text: "Delete",
          style: "destructive" as const,
          onPress: () => deleteNotification.mutate(item.id),
        },
        { text: "Cancel", style: "cancel" as const },
      ]);
    },
    [markRead, deleteNotification],
  );

  const renderItem = useCallback(
    ({ item }: { item: SerializedNotification }) => (
      <NotificationRow
        item={item}
        T={T}
        onPress={() => handlePress(item)}
        onLongPress={() => handleLongPress(item)}
      />
    ),
    [T, handlePress, handleLongPress],
  );

  return (
    <View style={[styles.container, { backgroundColor: T.pageBg }]}>
      <DomainHeader
        title="Notifications"
        color={T.accent}
        icon="bell"
        rightActions={
          unreadCount > 0 ? (
            <TouchableOpacity
              onPress={() => markAllRead.mutate()}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              style={styles.markAllBtn}
            >
              <Checks size={18} color={T.accent} weight="bold" />
              <Text style={[styles.markAllText, { color: T.accent }]}>Read all</Text>
            </TouchableOpacity>
          ) : null
        }
      />

      <View style={[styles.filterBar, { borderBottomColor: T.border }]}>
        {(["all", "unread"] as Tab[]).map((key) => {
          const active = tab === key;
          return (
            <TouchableOpacity
              key={key}
              style={[
                styles.filterPill,
                active
                  ? { backgroundColor: T.accent }
                  : {
                      backgroundColor: T.surface,
                      borderColor: T.border,
                      borderWidth: StyleSheet.hairlineWidth,
                    },
              ]}
              onPress={() => setTab(key)}
              activeOpacity={0.7}
            >
              <Text style={[styles.filterPillText, { color: active ? "#fff" : T.textDim }]}>
                {key === "all" ? "All" : `Unread${unreadCount > 0 ? ` (${unreadCount})` : ""}`}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {feed.isLoading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color={T.accent} />
        </View>
      ) : (
        <FlatList
          data={data}
          renderItem={renderItem}
          keyExtractor={(item) => item.id}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[
            data.length === 0 ? styles.emptyContent : styles.listContent,
            { paddingBottom: bottomPad },
          ]}
          ListEmptyComponent={<EmptyNotifications T={T} unreadOnly={tab === "unread"} />}
          refreshControl={
            <RefreshControl
              refreshing={feed.isFetching && !feed.isLoading}
              onRefresh={() => feed.refetch()}
              tintColor={T.accent}
              colors={[T.accent]}
            />
          }
        />
      )}
    </View>
  );
}

function NotificationRow({
  item,
  T,
  onPress,
  onLongPress,
}: {
  item: SerializedNotification;
  T: ThemeColors;
  onPress: () => void;
  onLongPress: () => void;
}) {
  const Icon = ICON_MAP[item.iconKind] ?? Megaphone;
  const accent = item.tone === "danger" ? T.red : item.tone === "warning" ? T.yellow : T.accent;
  return (
    <TouchableOpacity
      style={[
        styles.row,
        {
          borderBottomColor: T.border,
          backgroundColor: item.isRead ? "transparent" : T.accentSoft,
        },
      ]}
      onPress={onPress}
      onLongPress={onLongPress}
      activeOpacity={0.7}
    >
      {item.actorAvatarUrl || item.actorName ? (
        <View style={styles.avatarWrap}>
          <Avatar
            name={item.actorName || "?"}
            avatarUrl={item.actorAvatarUrl ?? undefined}
            size={38}
          />
          <View style={[styles.iconBadge, { backgroundColor: accent, borderColor: T.pageBg }]}>
            <Icon size={10} color="#fff" weight="fill" />
          </View>
        </View>
      ) : (
        <View style={[styles.iconCircle, { backgroundColor: accent + "22" }]}>
          <Icon size={18} color={accent} weight="duotone" />
        </View>
      )}
      <View style={styles.body}>
        <Text
          style={[
            styles.title,
            { color: T.textBright, fontFamily: item.isRead ? FONT.medium : FONT.bold },
          ]}
          numberOfLines={2}
        >
          {item.title}
        </Text>
        {item.body ? (
          <Text style={[styles.bodyText, { color: T.textDim }]} numberOfLines={2}>
            {item.body}
          </Text>
        ) : null}
        <Text style={[styles.time, { color: T.textDim }]}>{item.timeLabel}</Text>
      </View>
      {!item.isRead ? <View style={[styles.unreadDot, { backgroundColor: T.accent }]} /> : null}
    </TouchableOpacity>
  );
}

function EmptyNotifications({ T, unreadOnly }: { T: ThemeColors; unreadOnly: boolean }) {
  return (
    <View style={styles.emptyState}>
      <View style={[styles.emptyIconWrap, { backgroundColor: T.accentSoft }]}>
        <BellSimple size={36} color={T.accent} weight="duotone" />
      </View>
      <Text style={[styles.emptyTitle, { color: T.textBright }]}>
        {unreadOnly ? "All caught up" : "No notifications"}
      </Text>
      <Text style={[styles.emptySubtitle, { color: T.textDim }]}>
        {unreadOnly
          ? "You have no unread notifications"
          : "Mentions, shares, and reminders will show up here"}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  markAllBtn: { flexDirection: "row", alignItems: "center", gap: 4 },
  markAllText: { fontSize: 13, fontFamily: FONT.semibold },
  filterBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  filterPill: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  filterPillText: {
    fontSize: 13,
    fontFamily: FONT.medium,
    lineHeight: 18,
    includeFontPadding: false,
  },
  loadingWrap: { flex: 1, alignItems: "center", justifyContent: "center" },
  listContent: { paddingBottom: 24 },
  emptyContent: { flexGrow: 1 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 13,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  avatarWrap: { width: 38, height: 38 },
  iconBadge: {
    position: "absolute",
    right: -3,
    bottom: -3,
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  iconCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
  },
  body: { flex: 1, gap: 2 },
  title: { fontSize: 14, lineHeight: 19 },
  bodyText: { fontSize: 13, fontFamily: FONT.regular, lineHeight: 18 },
  time: { fontSize: 11, fontFamily: FONT.regular, marginTop: 2 },
  unreadDot: { width: 8, height: 8, borderRadius: 4, flexShrink: 0 },
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
