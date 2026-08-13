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
  Keyboard,
  Platform,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import { ChatText } from "phosphor-react-native";
import { useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { DomainHeader } from "@shared/components/DomainHeader";
import { bottomBarBlockHeight } from "@shared/components/BottomNav";
import { Avatar } from "@shared/components/Avatar";
import { ChatComposer } from "@features/chat/components/ChatComposer";
import { EmojiPickerSheet } from "@features/chat/components/EmojiPickerSheet";
import { MarkdownRenderer } from "@shared/components/MarkdownRenderer";
import { MessageAttachments } from "@features/chat/components/MessageAttachments";
import { useTheme } from "@shared/hooks/useTheme";
import type { ThemeColors } from "@theme/theme";
import { FONT } from "@theme/typography";
import { useAuth } from "@core/providers/AuthContext";
import { useUniffy } from "@core/providers/UniffyContext";
import { useAgents } from "@features/agents/useAgents";
import { useThread, useThreadMessages } from "@features/chat/useChat";
import {
  useSendThreadReply,
  useMarkThreadRead,
  useDeleteMessage,
} from "@features/chat/useChatMutations";
import { useChatStream } from "@features/chat/useChatStream";
import { useComposerAttachments } from "@features/chat/useComposerAttachments";
import { useDraftSync } from "@features/chat/useDraftSync";
import { useScreenFocusRef } from "@shared/hooks/useScreenFocusRef";
import {
  parseMentions,
  toCanonical,
  DOMAIN_TO_CONTENT_TYPE,
  type MentionEntry,
} from "@shared/mentions/useMentionInput";
import { sanitizeMentionLabel } from "@shared/mentions/mentionLabel";
import { MentionSuggestionsBar } from "@features/mentions/MentionSuggestionsBar";
import { useMentionTypeahead } from "@features/mentions/useMentionTypeahead";
import { applyMentionPick } from "@features/mentions/applyMentionPick";
import type { SerializedSearchResult } from "@features/search/searchSerializer";
import type { SerializedMessage } from "@features/chat/chatSerializer";

const GROUP_WINDOW_SECONDS = 300;

export function ChatThreadScreen() {
  const { id, channelId: channelIdParam } = useLocalSearchParams<{
    id: string;
    channelId: string;
  }>();
  const rootMessageId = id ?? "";
  const channelId = channelIdParam ?? "";
  const T = useTheme();
  const insets = useSafeAreaInsets();
  const barSpace = bottomBarBlockHeight(insets.bottom);
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
  // Cursor mirrored into state so the @-typeahead recomputes per keystroke.
  const [cursor, setCursor] = useState(0);
  const mentionTypeahead = useMentionTypeahead(draft, cursor);
  const attachments = useComposerAttachments();
  const screenFocused = useScreenFocusRef();

  const { flushOnSend } = useDraftSync({ channelId, rootMessageId, draft, setDraft, mentionsRef });

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

  const pickMentionSuggestion = useCallback(
    (item: SerializedSearchResult) => {
      const token = mentionTypeahead.token;
      if (!token) return;
      const pick = applyMentionPick(draft, token, item);
      mentionsRef.current.push(pick.mention);
      setDraft(pick.text);
      selectionRef.current = { start: pick.cursor, end: pick.cursor };
      setCursor(pick.cursor);
      setTimeout(() => inputRef.current?.setSelection(pick.cursor, pick.cursor), 30);
    },
    [draft, mentionTypeahead.token],
  );

  // A reference picked in the @ overlay is inserted at the cursor as @label.
  // Focus-guarded: the parent channel screen beneath has the same effect.
  useEffect(() => {
    if (!pendingReference || !screenFocused.current) return;
    const contentType = DOMAIN_TO_CONTENT_TYPE[pendingReference.domain] ?? "NOTE";
    const urn = `urn:uniffy:content:${contentType}:${pendingReference.id}`;
    const label = sanitizeMentionLabel(pendingReference.label);
    mentionsRef.current.push({ label, urn });
    insertAtCursor(`@${label} `, true);
    clearPendingReference();
    setTimeout(() => inputRef.current?.focus(), 50);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingReference]);

  const replies = useMemo(() => repliesQuery.data ?? [], [repliesQuery.data]);
  const root = threadQuery.data?.rootMessage ?? null;
  const replyCount = threadQuery.data?.replyCount ?? replies.length;

  const agentsQuery = useAgents();
  const agentFor = useCallback(
    (message: SerializedMessage) =>
      message.senderType === "AGENT"
        ? (agentsQuery.data?.find((a) => a.id === message.senderId) ?? null)
        : null,
    [agentsQuery.data],
  );

  const handleSend = useCallback(() => {
    const text = draft.trim();
    const attachmentFileIds = attachments.readyFileIds;
    if (!text && attachmentFileIds.length === 0) return;
    const content = toCanonical(draft, mentionsRef.current);
    flushOnSend();
    setDraft("");
    mentionsRef.current = [];
    attachments.clear();
    sendReply.mutate({ content, attachmentFileIds });
  }, [draft, attachments, sendReply, flushOnSend]);

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
      const agent = agentFor(item);
      return (
        <ThreadMessageRow
          message={item}
          T={T}
          organizationId={organizationId ?? ""}
          showHeader={showHeader}
          agentEmoji={agent?.avatarEmoji ?? null}
          agentName={agent?.name ?? null}
          onLongPress={() => handleLongPress(item)}
        />
      );
    },
    [replies, T, organizationId, handleLongPress, agentFor],
  );

  const canSend = !attachments.uploading && (!!draft.trim() || attachments.readyFileIds.length > 0);

  return (
    <View style={[styles.container, { backgroundColor: T.pageBg, paddingBottom: barSpace }]}>
      <DomainHeader
        title="Thread"
        subtitle={`${replyCount} ${replyCount === 1 ? "reply" : "replies"}`}
        color={T.accent}
        icon="chat"
      />

      {threadQuery.isLoading || repliesQuery.isLoading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color={T.accent} />
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
          keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
          ListFooterComponent={
            root ? (
              <View>
                <ThreadMessageRow
                  message={root}
                  T={T}
                  organizationId={organizationId ?? ""}
                  showHeader
                  agentEmoji={agentFor(root)?.avatarEmoji ?? null}
                  agentName={agentFor(root)?.name ?? null}
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

      {mentionTypeahead.token ? (
        <MentionSuggestionsBar
          results={mentionTypeahead.results}
          isLoading={mentionTypeahead.isLoading}
          onPick={pickMentionSuggestion}
        />
      ) : null}

      <ChatComposer
        T={T}
        inputRef={inputRef}
        draft={draft}
        onChangeDraft={setDraft}
        onSelectionChange={(e) => {
          selectionRef.current = e.nativeEvent.selection;
          setCursor(e.nativeEvent.selection.start);
        }}
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
  agentEmoji,
  agentName,
  onLongPress,
}: {
  message: SerializedMessage;
  T: ThemeColors;
  organizationId: string;
  showHeader: boolean;
  agentEmoji?: string | null;
  agentName?: string | null;
  onLongPress: () => void;
}) {
  const isAgent = message.senderType === "AGENT";
  const senderName = (isAgent && agentName) || message.senderName;
  return (
    <TouchableOpacity
      onLongPress={onLongPress}
      onPress={() => Keyboard.dismiss()}
      delayLongPress={250}
      activeOpacity={1}
      style={[styles.msgRow, !showHeader && styles.msgRowGrouped]}
    >
      <View style={styles.msgAvatar}>
        {showHeader ? (
          <Avatar
            name={senderName}
            avatarUrl={message.senderAvatarUrl ?? undefined}
            size={32}
            accentColor={isAgent ? T.accent : undefined}
            emoji={isAgent ? (agentEmoji ?? undefined) : undefined}
          />
        ) : null}
      </View>
      <View style={styles.msgBody}>
        {showHeader ? (
          <View style={styles.msgHeader}>
            <Text style={[styles.msgSender, { color: T.textBright }]} numberOfLines={1}>
              {senderName}
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
