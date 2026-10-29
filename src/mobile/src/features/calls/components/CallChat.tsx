import { useAuth } from "@core/providers/AuthContext";
import { MessageAttachments } from "@features/chat/components/MessageAttachments";
import { useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  FlatList,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { PaperPlaneRight, X } from "phosphor-react-native";
import { useMessages } from "@features/chat/useChat";
import { useSendMessage, useDiscardFailedMessage } from "@features/chat/useChatMutations";
import { useCall } from "@features/calls/CallContext";
import { callErrorMessage } from "@features/calls/callErrors";
import { MarkdownRenderer } from "@shared/components/MarkdownRenderer";
import { useTheme } from "@shared/hooks/useTheme";
import { FONT } from "@theme/typography";

export function CallChat({ channelId, onClose }: { channelId: string; onClose: () => void }) {
  const T = useTheme();
  const { organizationId } = useAuth();
  const { data, isLoading, isError, refetch, loadOlder, isLoadingOlder } = useMessages(channelId);
  const sendMessage = useSendMessage(channelId);
  const discard = useDiscardFailedMessage(channelId);
  const { showFeedback } = useCall();
  const [draft, setDraft] = useState("");
  const previous = useRef<string | null>(null);
  const newest = data[0];
  useEffect(() => {
    if (newest && previous.current && previous.current !== newest.id)
      AccessibilityInfo.announceForAccessibility(`${newest.senderName}: ${newest.content}`);
    if (newest) previous.current = newest.id;
  }, [newest]);
  const send = async (content: string, failedId?: string) => {
    if (!content.trim() || sendMessage.isPending) return;
    try {
      if (failedId) discard(failedId);
      await sendMessage.mutateAsync({ content });
      setDraft("");
    } catch (error) {
      setDraft("");
      showFeedback(callErrorMessage(error));
    }
  };
  const canSend = !!draft.trim() && !sendMessage.isPending;
  return (
    <View style={[styles.panel, { backgroundColor: T.surface, borderColor: T.border }]}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={[styles.title, { color: T.textBright }]}>Channel chat</Text>
          <Text style={[styles.subtitle, { color: T.textDim }]}>
            Messages stay here after this call.
          </Text>
        </View>
        <TouchableOpacity
          style={styles.close}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="Close chat"
          onPress={onClose}
        >
          <X size={20} color={T.text} weight="bold" />
        </TouchableOpacity>
      </View>
      {isLoading && <Text style={[styles.status, { color: T.textDim }]}>Loading messages...</Text>}
      {isError && (
        <TouchableOpacity
          accessibilityRole="button"
          activeOpacity={0.7}
          onPress={() => void refetch()}
          style={styles.textButton}
        >
          <Text style={[styles.action, { color: T.accent }]}>Retry loading messages</Text>
        </TouchableOpacity>
      )}
      <FlatList
        inverted
        data={data}
        keyExtractor={(m) => m.id}
        keyboardShouldPersistTaps="handled"
        onEndReached={() => {
          if (!isLoadingOlder)
            void loadOlder().catch((error) => showFeedback(callErrorMessage(error)));
        }}
        renderItem={({ item }) => (
          <View style={styles.message}>
            <Text style={[styles.sender, { color: T.textDim }]}>{item.senderName}</Text>
            <MarkdownRenderer content={item.isDeleted ? "Message deleted" : item.content} />
            {!item.isDeleted && organizationId && (
              <MessageAttachments
                attachments={item.attachments}
                organizationId={organizationId}
                T={T}
              />
            )}
            {item.metadata.failed === "1" && (
              <View style={styles.failedActions}>
                <TouchableOpacity
                  accessibilityRole="button"
                  activeOpacity={0.7}
                  onPress={() => void send(item.content, item.id)}
                  style={styles.textButton}
                >
                  <Text style={[styles.action, { color: T.accent }]}>Retry send</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  accessibilityRole="button"
                  activeOpacity={0.7}
                  onPress={() => discard(item.id)}
                  style={styles.textButton}
                >
                  <Text style={[styles.action, { color: T.textDim }]}>Discard</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        )}
      />
      <View style={styles.composer}>
        <TextInput
          multiline
          accessibilityLabel="Message channel"
          placeholder="Message channel..."
          placeholderTextColor={T.textDim}
          value={draft}
          onChangeText={setDraft}
          editable={!sendMessage.isPending}
          style={[
            styles.input,
            { color: T.textBright, backgroundColor: T.pageBg, borderColor: T.border },
          ]}
        />
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Send message"
          accessibilityState={{ disabled: !canSend }}
          disabled={!canSend}
          onPress={() => void send(draft)}
          activeOpacity={0.8}
          // Drawn at the chat composer's 38pt; the slop keeps a 44pt target.
          hitSlop={3}
          style={[styles.send, { backgroundColor: canSend ? T.accent : T.surfaceHover }]}
        >
          <PaperPlaneRight size={18} color={canSend ? "#fff" : T.textDim} weight="fill" />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    flex: 1,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 10,
  },
  header: { flexDirection: "row", alignItems: "center" },
  headerText: { flex: 1 },
  title: { fontSize: 15, fontFamily: FONT.semibold },
  subtitle: { fontSize: 12, fontFamily: FONT.regular, marginTop: 1 },
  close: { minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" },
  status: { fontSize: 13, fontFamily: FONT.regular, paddingVertical: 8 },
  textButton: { minHeight: 44, justifyContent: "center" },
  action: { fontSize: 13, fontFamily: FONT.medium },
  message: { paddingVertical: 8 },
  sender: { fontSize: 12, fontFamily: FONT.medium, marginBottom: 2 },
  failedActions: { flexDirection: "row", gap: 16 },
  composer: { flexDirection: "row", alignItems: "flex-end", gap: 8, paddingTop: 6 },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 100,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    fontFamily: FONT.regular,
  },
  // Centred on a single-line field, then pinned to its bottom as it grows.
  send: {
    width: 38,
    height: 38,
    borderRadius: 19,
    marginBottom: 3,
    alignItems: "center",
    justifyContent: "center",
  },
});
