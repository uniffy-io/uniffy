import React, { useMemo } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { BottomSheet } from "@shared/components/BottomSheet";
import { Avatar } from "@shared/components/Avatar";
import type { SerializedReaction } from "@features/chat/chatSerializer";
import type { ThemeColors } from "@theme/theme";
import { FONT } from "@theme/typography";

export function ReactorsSheet({
  reaction,
  currentUserId,
  T,
  resolveUserName,
  onClose,
}: {
  reaction: SerializedReaction | null;
  currentUserId?: string;
  T: ThemeColors;
  resolveUserName?: (userId: string) => string | undefined;
  onClose: () => void;
}) {
  // The server bounds the reactor list, so `count` carries everyone the names do not.
  const { names, remaining } = useMemo(() => {
    if (!reaction) return { names: [] as string[], remaining: 0 };
    const resolved: string[] = [];
    if (reaction.currentUserReacted) resolved.push("You");
    for (const id of reaction.userIds) {
      if (currentUserId && id === currentUserId) continue;
      resolved.push(resolveUserName?.(id) ?? id.slice(-6));
    }
    return { names: resolved, remaining: Math.max(0, reaction.count - resolved.length) };
  }, [reaction, currentUserId, resolveUserName]);

  return (
    <BottomSheet visible={!!reaction} onClose={onClose}>
      <View style={styles.header}>
        <Text style={styles.headerEmoji}>{reaction?.emoji}</Text>
        <Text style={[styles.title, { color: T.text }]}>
          {reaction?.count === 1 ? "1 reaction" : `${reaction?.count ?? 0} reactions`}
        </Text>
      </View>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        {names.map((name, index) => (
          <View key={`${name}-${index}`} style={[styles.row, { borderTopColor: T.border }]}>
            <Avatar name={name} size={28} />
            <Text style={[styles.name, { color: T.textBright }]} numberOfLines={1}>
              {name}
            </Text>
          </View>
        ))}
        {remaining > 0 ? (
          <Text style={[styles.more, { color: T.textDim }]}>and {remaining} more</Text>
        ) : null}
      </ScrollView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  headerEmoji: { fontSize: 20 },
  title: { fontSize: 16, fontFamily: FONT.semibold },
  scroll: { maxHeight: 360 },
  scrollContent: { paddingHorizontal: 16, paddingBottom: 12 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minHeight: 44,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  name: { flex: 1, fontSize: 15, fontFamily: FONT.medium },
  more: { fontSize: 13, fontFamily: FONT.regular, paddingTop: 10 },
});
