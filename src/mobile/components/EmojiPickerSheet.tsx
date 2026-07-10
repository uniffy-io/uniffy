import React from "react";
import { Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import type { ThemeColors } from "@/constants/theme";

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
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />
      <View style={[styles.sheet, { backgroundColor: T.surface }]}>
        <View style={[styles.handle, { backgroundColor: T.border }]} />
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
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)" },
  sheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingBottom: 32 },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    alignSelf: "center",
    marginTop: 8,
    marginBottom: 8,
  },
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
