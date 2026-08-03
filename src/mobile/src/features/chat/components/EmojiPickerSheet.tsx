import React from "react";
import { ScrollView, StyleSheet, Text, TouchableOpacity } from "react-native";
import { BottomSheet } from "@shared/components/BottomSheet";
import type { ThemeColors } from "@theme/theme";

const EMOJI_PALETTE = [
  "👍",
  "👎",
  "❤️",
  "🔥",
  "🎉",
  "😂",
  "😍",
  "🤔",
  "👀",
  "🙏",
  "✅",
  "❌",
  "💯",
  "🚀",
  "👏",
  "🙌",
  "😎",
  "😅",
  "😢",
  "😡",
  "🥳",
  "🤩",
  "😴",
  "🤝",
  "💪",
  "✨",
  "⭐",
  "💡",
  "📌",
  "⚡",
  "🎯",
  "🐛",
  "🔧",
  "📝",
  "💬",
  "👋",
  "🤞",
  "🫡",
  "😬",
  "🤯",
];

export function EmojiPickerSheet({
  visible,
  T,
  onClose,
  onPick,
}: {
  visible: boolean;
  T: ThemeColors;
  onClose: () => void;
  onPick: (emoji: string) => void;
}) {
  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <ScrollView contentContainerStyle={styles.emojiGrid}>
        {EMOJI_PALETTE.map((emoji) => (
          <TouchableOpacity
            key={emoji}
            style={[styles.emojiGridBtn, { backgroundColor: T.bg }]}
            onPress={() => onPick(emoji)}
            activeOpacity={0.7}
          >
            <Text style={styles.emojiGridText}>{emoji}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  emojiGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    justifyContent: "space-between",
  },
  emojiGridBtn: {
    width: 46,
    height: 46,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  emojiGridText: { fontSize: 24 },
});
