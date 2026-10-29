import { useAuth } from "@core/providers/AuthContext";
import { MessageAttachments } from "@features/chat/components/MessageAttachments";
import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, FlatList, Pressable, Text, TextInput, View } from "react-native";
import { PaperPlaneTilt, X } from "phosphor-react-native";
import { useMessages } from "@features/chat/useChat";
import { useSendMessage, useDiscardFailedMessage } from "@features/chat/useChatMutations";
import { useCall } from "@features/calls/CallContext";
import { callErrorMessage } from "@features/calls/callErrors";
import { MarkdownRenderer } from "@shared/components/MarkdownRenderer";
import { useTheme } from "@shared/hooks/useTheme";

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
  return (
    <View style={{ flex: 1, backgroundColor: T.surface, borderRadius: 12, padding: 10 }}>
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: T.text, fontWeight: "600" }}>Channel chat</Text>
          <Text style={{ color: T.textDim, fontSize: 12 }}>
            Messages stay here after this call.
          </Text>
        </View>
        <Pressable
          style={{ minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" }}
          accessibilityRole="button"
          accessibilityLabel="Close chat"
          onPress={onClose}
        >
          <X size={20} color={T.text} />
        </Pressable>
      </View>
      {isLoading && <Text style={{ color: T.textDim }}>Loading messages...</Text>}
      {isError && (
        <Pressable
          accessibilityRole="button"
          onPress={() => void refetch()}
          style={{ minHeight: 44, justifyContent: "center" }}
        >
          <Text style={{ color: T.accent }}>Retry loading messages</Text>
        </Pressable>
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
          <View style={{ paddingVertical: 8 }}>
            <Text style={{ color: T.textDim, fontSize: 12 }}>{item.senderName}</Text>
            <MarkdownRenderer content={item.isDeleted ? "Message deleted" : item.content} />
            {!item.isDeleted && organizationId && (
              <MessageAttachments
                attachments={item.attachments}
                organizationId={organizationId}
                T={T}
              />
            )}
            {item.metadata.failed === "1" && (
              <View style={{ flexDirection: "row", gap: 16 }}>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => void send(item.content, item.id)}
                  style={{ minHeight: 44, justifyContent: "center" }}
                >
                  <Text style={{ color: T.accent }}>Retry send</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => discard(item.id)}
                  style={{ minHeight: 44, justifyContent: "center" }}
                >
                  <Text style={{ color: T.textDim }}>Discard</Text>
                </Pressable>
              </View>
            )}
          </View>
        )}
      />
      <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 8 }}>
        <TextInput
          multiline
          accessibilityLabel="Message channel"
          placeholder="Message channel..."
          placeholderTextColor={T.textDim}
          value={draft}
          onChangeText={setDraft}
          editable={!sendMessage.isPending}
          style={{
            flex: 1,
            color: T.text,
            backgroundColor: T.pageBg,
            borderColor: T.border,
            borderWidth: 1,
            borderRadius: 10,
            minHeight: 44,
            maxHeight: 100,
            padding: 10,
          }}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Send message"
          disabled={sendMessage.isPending || !draft.trim()}
          onPress={() => void send(draft)}
          style={{ minHeight: 44, minWidth: 44, alignItems: "center", justifyContent: "center" }}
        >
          <PaperPlaneTilt size={22} color={T.accent} />
        </Pressable>
      </View>
    </View>
  );
}
