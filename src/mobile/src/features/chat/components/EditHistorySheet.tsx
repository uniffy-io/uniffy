import React from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { BottomSheet } from "@shared/components/BottomSheet";
import { MarkdownRenderer } from "@shared/components/MarkdownRenderer";
import { useMessageRevisions } from "@features/chat/useChat";
import { formatMessageTime, type SerializedMessage } from "@features/chat/chatSerializer";
import type { ThemeColors } from "@theme/theme";
import { FONT } from "@theme/typography";

export function EditHistorySheet({
  message,
  T,
  onClose,
}: {
  message: SerializedMessage | null;
  T: ThemeColors;
  onClose: () => void;
}) {
  const revisionsQuery = useMessageRevisions(message?.channelId, message?.id);
  const revisions = revisionsQuery.data;

  return (
    <BottomSheet visible={!!message} onClose={onClose}>
      <Text style={[styles.title, { color: T.text }]}>Edit history</Text>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        {message ? (
          <View style={[styles.entry, { borderColor: T.border }]}>
            <Text style={[styles.entryLabel, { color: T.textDim }]}>
              Current, edited {formatMessageTime(message.editedAtSeconds ?? 0)}
            </Text>
            <MarkdownRenderer content={message.content} />
          </View>
        ) : null}
        {revisionsQuery.isError ? (
          <Text style={[styles.hint, { color: T.textDim }]}>Could not load edit history.</Text>
        ) : revisions === undefined ? (
          <Text style={[styles.hint, { color: T.textDim }]}>Loading...</Text>
        ) : revisions.length === 0 ? (
          <Text style={[styles.hint, { color: T.textDim }]}>No earlier versions recorded.</Text>
        ) : (
          [...revisions].reverse().map((revision) => (
            <View key={revision.revisionNo} style={[styles.entry, { borderColor: T.border }]}>
              <Text style={[styles.entryLabel, { color: T.textDim }]}>
                {revision.revisionNo === 1 ? "Original" : "Revision"}, until{" "}
                {formatMessageTime(revision.editedAtSeconds)}
              </Text>
              <MarkdownRenderer content={revision.content} />
            </View>
          ))
        )}
      </ScrollView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  title: {
    fontSize: 16,
    fontFamily: FONT.semibold,
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 10,
  },
  scroll: { maxHeight: 420 },
  scrollContent: { paddingHorizontal: 16, paddingBottom: 12, gap: 10 },
  entry: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, padding: 10 },
  entryLabel: { fontSize: 11, fontFamily: FONT.regular, marginBottom: 4 },
  hint: { fontSize: 13, fontFamily: FONT.regular, paddingVertical: 8 },
});
