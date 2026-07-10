import React, { useEffect, useMemo, useState, useCallback, useRef } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  Alert,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import { ChatText } from "phosphor-react-native";
import { useLocalSearchParams } from "expo-router";
import { DomainHeader } from "@/components/DomainHeader";
import { Avatar } from "@/components/Avatar";
import { ChatComposer } from "@/components/ChatComposer";
import { EmojiPickerSheet } from "@/components/EmojiPickerSheet";
import { MarkdownRenderer } from "@/components/MarkdownRenderer";
import { MessageAttachments } from "@/components/MessageAttachments";
import { useTheme } from "@/hooks/useTheme";
import type { ThemeColors } from "@/constants/theme";
import { FONT } from "@/constants/typography";
import { useAuth } from "@/context/auth-context";
import { useUniffy } from "@/context/uniffy-context";
import { useThread, useThreadMessages } from "@/hooks/useChat";
import { useSendThreadReply, useMarkThreadRead, useDeleteMessage } from "@/hooks/useChatMutations";
import { useChatStream } from "@/hooks/useChatStream";
import { useComposerAttachments } from "@/hooks/useComposerAttachments";
import { useScreenFocusRef } from "@/hooks/useScreenFocusRef";
import {
  parseMentions,
  toCanonical,
  DOMAIN_TO_CONTENT_TYPE,
  type MentionEntry,
} from "@/hooks/useMentionInput";
import type { SerializedMessage } from "@/lib/chatSerializer";

const GROUP_WINDOW_SECONDS = 300;

export default function ChatThreadScreen() {
  const { id, channelId: channelIdParam } = useLocalSearchParams<{
    id: string;
    channelId: string;
  }>();
  const rootMessageId = id ?? "";
  const channelId = channelIdParam ?? "";
  const T = useTheme();
  const { user, organizationId } = useAuth();
  const { openAt, pendingReference, clearPendingReference } = useUniffy();

  useChatStream();
  const threadQuery = useThread(channelId, rootMessageId);
  const repliesQuery = useThreadMessages(channelId, rootMessageId);
  const sendReply = useSendThreadReply(channelId, rootMessageId);
  const markThreadRead = useMarkThreadRead();
  const deleteMessage = useDeleteMessage(channelId);

  const [draft, setDraft] = useState("");
  const [emojiOpen, setEmojiOpen] = useState(false);
  const mentionsRef = useRef<MentionEntry[]>([]);
  const selectionRef = useRef({ start: 0, end: 0 });
  const inputRef = useRef<TextInput>(null);
  const attachments = useComposerAttachments();
  const screenFocused = useScreenFocusRef();

  useEffect(() => {
    if (rootMessageId) markThreadRead.mutate(rootMessageId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rootMessageId]);

  const insertAtCursor = useCallback((text: string, padBefore: boolean) => {
    setDraft((prev) => {
      const pos = Math.min(selectionRef.current.start, prev.length);
      const before = prev.substring(0, pos);
      const after = prev.substring(pos);
      const needsSpace =
        padBefore && before.length > 0 && !before.endsWith(" ") && !before.endsWith("\n");
      return before + (needsSpace ? " " : "") + text + after;
    });
  }, []);

  const wrapSelection = useCallback((marker: string) => {
    setDraft((prev) => {
      const { start, end } = selectionRef.current;
      const s = Math.min(start, prev.length);
      const e = Math.min(Math.max(end, start), prev.length);
      const selected = prev.substring(s, e);
      return prev.substring(0, s) + marker + selected + marker + prev.substring(e);
    });
    setTimeout(() => inputRef.current?.focus(), 30);
  }, []);

  // A reference picked in the @ overlay is inserted at the cursor as @label.
  // Focus-guarded: the parent channel screen beneath has the same effect.
  useEffect(() => {
    if (!pendingReference || !screenFocused.current) return;
    const contentType = DOMAIN_TO_CONTENT_TYPE[pendingReference.domain] ?? "NOTE";
    const urn = `urn:uniffy:content:${contentType}:${pendingReference.id}`;
    mentionsRef.current.push({ label: pendingReference.label, urn });
    insertAtCursor(`@${pendingReference.label} `, true);
    clearPendingReference();
    setTimeout(() => inputRef.current?.focus(), 50);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingReference]);

  const replies = useMemo(() => repliesQuery.data ?? [], [repliesQuery.data]);
  const root = threadQuery.data?.rootMessage ?? null;
  const replyCount = threadQuery.data?.replyCount ?? replies.length;

  const handleSend = useCallback(() => {
    const text = draft.trim();
    const attachmentFileIds = attachments.readyFileIds;
    if (!text && attachmentFileIds.length === 0) return;
    const content = toCanonical(draft, mentionsRef.current);
    setDraft("");
    mentionsRef.current = [];
    attachments.clear();
    sendReply.mutate({ content, attachmentFileIds });
  }, [draft, attachments, sendReply]);

  const handleLongPress = useCallback(
    (message: SerializedMessage) => {
      const { display } = parseMentions(message.content);
      const isOwn = message.senderId === user?.id && message.senderType === "USER";
      Alert.alert("Message", undefined, [
        { text: "Cancel", style: "cancel" },
        {
          text: "Copy text",
          onPress: () => {
            void Clipboard.setStringAsync(display);
          },
        },
        ...(isOwn
          ? [
              {
                text: "Delete",
                style: "destructive" as const,
                onPress: () => deleteMessage.mutate(message.id),
              },
            ]
          : []),
      ]);
    },
    [user?.id, deleteMessage],
  );

  const renderItem = useCallback(
    ({ item, index }: { item: SerializedMessage; index: number }) => {
      const older = replies[index + 1];
      const showHeader =
        !older ||
        older.senderId !== item.senderId ||
        item.createdAtSeconds - older.createdAtSeconds > GROUP_WINDOW_SECONDS;
      return (
        <ThreadMessageRow
          message={item}
          T={T}
          organizationId={organizationId ?? ""}
          showHeader={showHeader}
          onLongPress={() => handleLongPress(item)}
        />
      );
    },
    [replies, T, organizationId, handleLongPress],
  );

  const canSend = !attachments.uploading && (!!draft.trim() || attachments.readyFileIds.length > 0);

  return (
    <View style={[styles.container, { backgroundColor: T.pageBg }]}>
      <DomainHeader
        title="Thread"
        subtitle={`${replyCount} ${replyCount === 1 ? "reply" : "replies"}`}
        color={T.domains.chat}
        icon="chat"
      />

      {threadQuery.isLoading || repliesQuery.isLoading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color={T.domains.chat} />
        </View>
      ) : (
        <FlatList
          data={replies}
          renderItem={renderItem}
          keyExtractor={(item) => item.id}
          inverted
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.listContent}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          ListFooterComponent={
            root ? (
              <View>
                <ThreadMessageRow
                  message={root}
                  T={T}
                  organizationId={organizationId ?? ""}
                  showHeader
                  onLongPress={() => handleLongPress(root)}
                />
                <View style={styles.repliesDivider}>
                  <View style={[styles.dividerLine, { backgroundColor: T.border }]} />
                  <View style={styles.dividerLabel}>
                    <ChatText size={12} color={T.textDim} weight="duotone" />
                    <Text style={[styles.dividerText, { color: T.textDim }]}>
                      {replyCount} {replyCount === 1 ? "reply" : "replies"}
                    </Text>
                  </View>
                  <View style={[styles.dividerLine, { backgroundColor: T.border }]} />
                </View>
              </View>
            ) : null
          }
        />
      )}

      <ChatComposer
        T={T}
        inputRef={inputRef}
        draft={draft}
        onChangeDraft={setDraft}
        onSelectionChange={(e) => (selectionRef.current = e.nativeEvent.selection)}
        placeholder="Reply in thread"
        canSend={canSend}
        onSend={handleSend}
        tools={{
          onEmoji: () => setEmojiOpen(true),
          onMention: () => openAt(true),
          onAttach: attachments.handleAttach,
          onWrap: wrapSelection,
        }}
        attachments={attachments.pending}
        onRemoveAttachment={attachments.remove}
      />

      <EmojiPickerSheet
        visible={emojiOpen}
        T={T}
        onClose={() => setEmojiOpen(false)}
        onPick={(emoji) => {
          insertAtCursor(emoji, false);
          setEmojiOpen(false);
        }}
      />
    </View>
  );
}

function ThreadMessageRow({
  message,
  T,
  organizationId,
  showHeader,
  onLongPress,
}: {
  message: SerializedMessage;
  T: ThemeColors;
  organizationId: string;
  showHeader: boolean;
  onLongPress: () => void;
}) {
  const isAgent = message.senderType === "AGENT";
  return (
    <TouchableOpacity
      onLongPress={onLongPress}
      delayLongPress={250}
      activeOpacity={1}
      style={[styles.msgRow, !showHeader && styles.msgRowGrouped]}
    >
      <View style={styles.msgAvatar}>
        {showHeader ? (
          <Avatar
            name={message.senderName}
            avatarUrl={message.senderAvatarUrl ?? undefined}
            size={32}
            accentColor={isAgent ? T.domains.chat : undefined}
          />
        ) : null}
      </View>
      <View style={styles.msgBody}>
        {showHeader ? (
          <View style={styles.msgHeader}>
            <Text style={[styles.msgSender, { color: T.textBright }]} numberOfLines={1}>
              {message.senderName}
            </Text>
            <Text style={[styles.msgTime, { color: T.textDim }]}>{message.timeLabel}</Text>
          </View>
        ) : null}
        <MarkdownRenderer content={message.content} />
        {message.attachments.length > 0 ? (
          <MessageAttachments
            attachments={message.attachments}
            organizationId={organizationId}
            T={T}
          />
        ) : null}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  loadingWrap: { flex: 1, alignItems: "center", justifyContent: "center" },
  listContent: { paddingVertical: 12 },
  msgRow: { flexDirection: "row", gap: 10, paddingHorizontal: 16, paddingTop: 10 },
  msgRowGrouped: { paddingTop: 1 },
  msgAvatar: { width: 32 },
  msgBody: { flex: 1, gap: 3 },
  msgHeader: { flexDirection: "row", alignItems: "center", gap: 7 },
  msgSender: { fontSize: 14, fontFamily: FONT.semibold, flexShrink: 1 },
  msgTime: { fontSize: 11, fontFamily: FONT.regular },
  repliesDivider: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  dividerLine: { flex: 1, height: StyleSheet.hairlineWidth },
  dividerLabel: { flexDirection: "row", alignItems: "center", gap: 5 },
  dividerText: { fontSize: 11, fontFamily: FONT.medium },
});
