import React, { useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from "react-native";
import { CaretDown, CaretUp, CheckCircle } from "phosphor-react-native";
import type { ThemeColors } from "@theme/theme";
import { FONT } from "@theme/typography";

export type ThinkingBlockView = {
  blockId: string;
  content: string;
  elapsedMs: number;
  done: boolean;
};

export function formatThinkingDuration(elapsedMs: number): string {
  const totalSeconds = Math.max(1, Math.round(elapsedMs / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

// Thinking renders as plain text; bold markers from provider summaries would
// otherwise show as raw asterisks.
function stripBoldMarkers(text: string): string {
  return text.replace(/\*\*/g, "");
}

/**
 * Collapsible reasoning pane above an agent reply. Duration comes from the
 * runtime-stamped elapsed_ms, never client clocks. Auto-collapses once the
 * answer starts unless the user explicitly toggled it.
 */
export function ThinkingPane({
  blocks,
  live,
  answerStarted,
  T,
}: {
  blocks: readonly ThinkingBlockView[];
  live: boolean;
  answerStarted: boolean;
  T: ThemeColors;
}) {
  const [userToggle, setUserToggle] = useState<boolean | null>(null);

  if (blocks.length === 0) return null;

  const expanded = userToggle ?? !answerStarted;
  const totalMs = blocks.reduce((sum, b) => sum + b.elapsedMs, 0);
  const settled = !live && blocks.every((b) => b.done);

  return (
    <View style={styles.pane}>
      <TouchableOpacity
        style={styles.header}
        onPress={() => setUserToggle(!expanded)}
        activeOpacity={0.6}
      >
        {live ? (
          <>
            <ActivityIndicator size={13} color={T.textDim} />
            <Text style={[styles.headerText, { color: T.textDim }]}>Thinking...</Text>
          </>
        ) : (
          <Text style={[styles.headerText, { color: T.textDim }]}>
            Thought for {formatThinkingDuration(totalMs)}
          </Text>
        )}
        {expanded ? (
          <CaretUp size={12} color={T.textDim} weight="bold" />
        ) : (
          <CaretDown size={12} color={T.textDim} weight="bold" />
        )}
      </TouchableOpacity>
      {expanded ? (
        <View style={styles.body}>
          {blocks.map((block, idx) => (
            <View key={block.blockId || idx} style={[styles.block, { borderLeftColor: T.border }]}>
              <Text style={[styles.blockText, { color: T.textDim }]}>
                {stripBoldMarkers(block.content)}
              </Text>
            </View>
          ))}
          {settled ? (
            <View style={styles.doneRow}>
              <CheckCircle size={13} color={T.textDim} weight="fill" />
              <Text style={[styles.doneText, { color: T.textDim }]}>Done</Text>
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  pane: { alignSelf: "stretch", marginBottom: 4 },
  header: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 2 },
  headerText: { fontSize: 13, fontFamily: FONT.regular },
  body: { marginTop: 2, gap: 6 },
  block: { borderLeftWidth: 2, paddingLeft: 10 },
  blockText: { fontSize: 13, fontFamily: FONT.regular, lineHeight: 19 },
  doneRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  doneText: { fontSize: 13, fontFamily: FONT.regular },
});
