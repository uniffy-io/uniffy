import React from "react";
import { View, Text, StyleSheet, Platform } from "react-native";
import { CaretDown, CaretUp } from "phosphor-react-native";
import type { ThemeColors } from "@theme/theme";
import { FONT } from "@theme/typography";

export const MONO_FONT = Platform.select({ ios: "Menlo", default: "monospace" });

// Expanded payloads render fully inline and scroll with the conversation: a
// nested ScrollView never receives scroll gestures inside the inverted chat
// list on Android. The cap keeps a giant payload from bloating the list.
const MONO_CHAR_LIMIT = 20000;

// Matches the row gap of the cards that host these blocks: expanded details add
// this on top of their own measured height, so the inverted-list scroll
// compensation stays exact.
export const DETAILS_GAP = 6;

export function DetailsCaret({ T, open }: { T: ThemeColors; open: boolean }) {
  return (
    <View style={styles.caret}>
      {open ? (
        <CaretUp size={12} color={T.textDim} weight="bold" />
      ) : (
        <CaretDown size={12} color={T.textDim} weight="bold" />
      )}
    </View>
  );
}

export function MonoBlock({ T, text }: { T: ThemeColors; text: string }) {
  const truncated = text.length > MONO_CHAR_LIMIT;
  return (
    <View style={[styles.monoBlock, { backgroundColor: T.bg, borderColor: T.border }]}>
      <Text style={[styles.monoText, { color: T.text }]}>
        {truncated ? text.slice(0, MONO_CHAR_LIMIT) : text}
      </Text>
      {truncated ? (
        <Text style={[styles.monoTruncatedNote, { color: T.textDim }]}>Output truncated</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  caret: { paddingTop: 2 },
  monoBlock: {
    borderRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 8,
  },
  monoTruncatedNote: { fontSize: 10, fontFamily: FONT.medium, marginTop: 6 },
  monoText: { fontSize: 11, fontFamily: MONO_FONT, lineHeight: 16 },
});
