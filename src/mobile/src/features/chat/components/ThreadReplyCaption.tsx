import React from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { ChatText } from "phosphor-react-native";
import type { ThemeColors } from "@theme/theme";
import { FONT } from "@theme/typography";
import type { SerializedThreadReplyContext } from "@features/chat/chatSerializer";

/** The optional preview uses a cached root; opening the thread fetches its content. */
export function ThreadReplyCaption({
  context,
  rootPreview,
  T,
  onPress,
}: {
  context: SerializedThreadReplyContext;
  rootPreview?: string;
  T: ThemeColors;
  onPress: (rootMessageId: string) => void;
}) {
  return (
    <TouchableOpacity
      style={styles.caption}
      onPress={() => onPress(context.rootMessageId)}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel="Replied to a thread. Open the thread"
    >
      <ChatText size={12} color={T.textDim} weight="duotone" />
      <Text style={[styles.label, { color: T.textDim }]}>Replied to a thread</Text>
      {rootPreview ? (
        <>
          <Text style={[styles.label, { color: T.textDim }]}>·</Text>
          <View style={styles.previewWrap}>
            <Text style={[styles.preview, { color: T.textDim }]} numberOfLines={1}>
              {rootPreview}
            </Text>
          </View>
        </>
      ) : null}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  caption: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 4 },
  label: { fontSize: 11, fontFamily: FONT.medium },
  // The preview is the only part that may be cut, so it owns the flexible slot;
  // without the wrapper the row's gap pushes it past the bubble's edge.
  previewWrap: { flexShrink: 1 },
  preview: { fontSize: 11, fontFamily: FONT.regular },
});
