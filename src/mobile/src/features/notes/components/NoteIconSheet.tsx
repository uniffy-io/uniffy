import React from "react";
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from "react-native";
import { BottomSheet } from "@shared/components/BottomSheet";
import { useTheme } from "@shared/hooks/useTheme";
import { FONT } from "@theme/typography";

// Emoji only. Web additionally offers a curated Phosphor set, but those names
// resolve through a web-only component registry, so mirroring them here would
// render blanks on device. The emoji set mirrors the web picker's
// COMMON_EMOJIS (icon-picker/iconConstants.ts) so both platforms offer the
// same values for `icon.value`.
const EMOJIS = [
  // Work & Productivity
  "📝",
  "📋",
  "📌",
  "💡",
  "🎯",
  "✅",
  "📊",
  "💼",
  // Status & Reactions
  "⭐",
  "❤️",
  "🔥",
  "⚡",
  "🌟",
  "💎",
  "✨",
  "👍",
  // Categories
  "📁",
  "🏷️",
  "🔖",
  "📚",
  "🗂️",
  "📂",
  "🔑",
  "🔒",
  // Creative
  "🎨",
  "🎵",
  "📷",
  "🎬",
  "🎮",
  "🎧",
  "🖼️",
  "🎭",
  // Nature & Objects
  "🌈",
  "☀️",
  "🌙",
  "🌻",
  "🌸",
  "🍀",
  "🌊",
  "🔮",
  // People & Activities
  "🚀",
  "🏆",
  "🎁",
  "🎉",
  "🎊",
  "💪",
  "🙌",
  "👏",
  // Food & Drink
  "☕",
  "🍕",
  "🍔",
  "🍎",
  "🍰",
  "🍩",
  "🥤",
  "🍿",
  // Travel
  "✈️",
  "🚗",
  "🏠",
  "🌍",
  "🗺️",
  "🏝️",
  "🏔️",
  "🌆",
];

export function NoteIconSheet({
  visible,
  onClose,
  current,
  onSelect,
  onClear,
}: {
  visible: boolean;
  onClose: () => void;
  current?: string;
  onSelect: (emoji: string) => void;
  onClear: () => void;
}) {
  const T = useTheme();

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: T.textBright }]}>Note icon</Text>
        {current ? (
          <TouchableOpacity onPress={onClear} activeOpacity={0.7}>
            <Text style={[styles.clear, { color: T.accent }]}>Remove</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      <ScrollView contentContainerStyle={styles.grid} showsVerticalScrollIndicator={false}>
        {EMOJIS.map((emoji) => {
          const active = current === emoji;
          return (
            <TouchableOpacity
              key={emoji}
              style={[
                styles.cell,
                {
                  backgroundColor: active ? T.accentSoft : T.surface,
                  borderColor: active ? T.accent : T.border,
                },
              ]}
              onPress={() => onSelect(emoji)}
              activeOpacity={0.7}
            >
              <Text style={styles.emoji}>{emoji}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingTop: 4,
    paddingBottom: 12,
  },
  title: { fontSize: 17, fontFamily: FONT.semibold },
  clear: { fontSize: 14, fontFamily: FONT.medium },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  cell: {
    width: 52,
    height: 52,
    borderRadius: 13,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  emoji: { fontSize: 24 },
});
