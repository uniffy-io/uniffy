import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  Modal,
  Alert,
  Pressable,
  ScrollView,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import {
  Trash,
  Copy,
  Hash,
  Lock,
  Robot,
  ChatCircle,
  ChatText,
  Smiley,
  PushPin,
  PushPinSlash,
  PencilSimple,
  ArrowBendUpLeft,
  WarningCircle,
  X,
  Gauge,
  Phone,
} from "phosphor-react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { DomainHeader } from "@shared/components/DomainHeader";
import { bottomBarBlockHeight } from "@shared/components/BottomNav";
import { Avatar } from "@shared/components/Avatar";
import { ChatComposer } from "@features/chat/components/ChatComposer";
import { TypingIndicator } from "@features/chat/components/TypingIndicator";
import { EmojiPickerSheet } from "@features/chat/components/EmojiPickerSheet";
import { MarkdownRenderer } from "@shared/components/MarkdownRenderer";
import { SystemMessage } from "@features/chat/components/SystemMessage";
import { MessageAttachments } from "@features/chat/components/MessageAttachments";
import { AgentMessageBody, isSpecialAgentKind } from "@features/agents/components/AgentMessageBody";
import { AgentApprovalCard } from "@features/agents/components/AgentApprovalCard";
import { AgentContextSheet } from "@features/agents/components/AgentContextSheet";
import { ChannelDetailsSheet } from "@features/chat/components/ChannelDetailsSheet";
import { PreJoinSheet } from "@features/calls/components/PreJoinSheet";
import { useCall } from "@features/calls/CallContext";
import { useActiveCall } from "@features/calls/useCallsState";
import { usePresences } from "@shared/presence/usePresence";
import { useTheme } from "@shared/hooks/useTheme";
import type { ThemeColors } from "@theme/theme";
import { FONT } from "@theme/typography";
import { useAuth } from "@core/providers/AuthContext";
import { useUniffy } from "@core/providers/UniffyContext";
import {
  useChannel,
  useMessages,
  useChannelMembers,
  useChannelPendingApprovals,
  usePinnedMessages,
  useCategories,
} from "@features/chat/useChat";
import {
  useSendMessage,
  useDeleteMessage,
  useToggleReaction,
  useMarkChannelRead,
  useEditMessage,
  usePinMessage,
  useDiscardFailedMessage,
  useRespondToAgentConfirmation,
  useUpdateChannel,
  useRenameAgentChat,
  useArchiveChannel,
  useDeleteChannel,
  useAddMembers,
  useRemoveMembers,
  useUpdateChannelMember,
  useMoveChannelToCategory,
  useLeaveChannel,
} from "@features/chat/useChatMutations";
import { useDirectory } from "@shared/permissions/usePermissions";
import { useAgents, useStopAgentRun } from "@features/agents/useAgents";
import {
  useChatStream,
  typingKey,
  useRunningAgents,
  type TypingEntry,
} from "@features/chat/useChatStream";
import { useComposerAttachments } from "@features/chat/useComposerAttachments";
import { useScreenFocusRef } from "@shared/hooks/useScreenFocusRef";
import { chatApi } from "@features/chat/chatApi";
import {
  parseMentions,
  toCanonical,
  DOMAIN_TO_CONTENT_TYPE,
  type MentionEntry,
} from "@shared/mentions/useMentionInput";
import { resolveChannelTitle, type SerializedMessage } from "@features/chat/chatSerializer";

const GROUP_WINDOW_SECONDS = 300;
const QUICK_EMOJIS = ["👍", "❤️", "😂", "🎉", "👀", "🙏"];
type SelectionRange = { start: number; end: number };

const EMOJI_RE = /\p{Emoji_Presentation}|\p{Emoji}\uFE0F/gu;

/** Emoji-only messages (1-3 emoji, no other text) render jumbo-sized. */
function isEmojiOnly(text: string): boolean {
  const stripped = text.replace(/\s/g, "");
  if (!stripped) return false;
  const matches = stripped.match(EMOJI_RE);
  if (!matches) return false;
  return stripped.replace(EMOJI_RE, "").length === 0 && matches.length <= 3;
}

function isSameDay(aSeconds: number, bSeconds: number): boolean {
  return new Date(aSeconds * 1000).toDateString() === new Date(bSeconds * 1000).toDateString();
}

function formatDayLabel(seconds: number): string {
  const date = new Date(seconds * 1000);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) return "Today";
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  const sameYear = date.getFullYear() === now.getFullYear();
  return date.toLocaleDateString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

export function ChatConversationScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const channelId = id ?? "";
  const T = useTheme();
  const insets = useSafeAreaInsets();
  const barSpace = bottomBarBlockHeight(insets.bottom);
  const { user, organizationId } = useAuth();
  const { pendingReference, clearPendingReference, openAt } = useUniffy();
  const queryClient = useQueryClient();

  useChatStream();
  const channelQuery = useChannel(channelId);
  const messagesQuery = useMessages(channelId);
  const membersQuery = useChannelMembers(channelId);
  const approvalsQuery = useChannelPendingApprovals(channelId, true);
  const sendMessage = useSendMessage(channelId);
  const deleteMessage = useDeleteMessage(channelId);
  const toggleReaction = useToggleReaction(channelId);
  const editMessage = useEditMessage(channelId);
  const pinMessage = usePinMessage(channelId);
  const markRead = useMarkChannelRead(channelId);
  const stopAgent = useStopAgentRun();
  const respondToConfirmation = useRespondToAgentConfirmation(channelId);
  const updateChannel = useUpdateChannel(channelId);
  const renameAgentChat = useRenameAgentChat(channelId);
  const archiveChannel = useArchiveChannel();
  const deleteChannel = useDeleteChannel();
  const addMembers = useAddMembers(channelId);
  const removeMembers = useRemoveMembers(channelId);
  const updateChannelMember = useUpdateChannelMember(channelId);
  const moveChannelToCategory = useMoveChannelToCategory();
  const leaveChannel = useLeaveChannel();
  const categoriesQuery = useCategories();
  const directory = useDirectory();
  const agentsQuery = useAgents();

  const [draft, setDraft] = useState("");
  const mentionsRef = useRef<MentionEntry[]>([]);
  const selectionRef = useRef<SelectionRange>({ start: 0, end: 0 });
  const inputRef = useRef<TextInput>(null);
  const [actionMessage, setActionMessage] = useState<SerializedMessage | null>(null);
  const [replyTo, setReplyTo] = useState<SerializedMessage | null>(null);
  const [editing, setEditing] = useState<SerializedMessage | null>(null);
  const [emojiTarget, setEmojiTarget] = useState<SerializedMessage | "compose" | null>(null);
  const [pinnedOpen, setPinnedOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [contextAgentId, setContextAgentId] = useState<string | null>(null);
  const [prejoinOpen, setPrejoinOpen] = useState(false);
  const { session: callSession, setMinimized, available: callsAvailable } = useCall();
  const activeCall = useActiveCall(channelId);
  const inCallHere = callSession.channelId === channelId && callSession.status !== "idle";
  const attachments = useComposerAttachments();
  const screenFocused = useScreenFocusRef();

  const pinnedQuery = usePinnedMessages(channelId, pinnedOpen);

  const allMessages = useMemo(() => messagesQuery.data ?? [], [messagesQuery.data]);
  const channel = channelQuery.data;

  // Tool results are absorbed into their tool-call card; only orphans render.
  const toolResultsById = useMemo(() => {
    const map = new Map<string, SerializedMessage>();
    for (const m of allMessages) {
      if (m.senderType === "AGENT" && m.metadata?.kind === "tool_result") {
        const callId = m.metadata.tool_call_id;
        if (callId) map.set(callId, m);
      }
    }
    return map;
  }, [allMessages]);

  const messages = useMemo(() => {
    const callIds = new Set<string>();
    for (const m of allMessages) {
      if (m.senderType === "AGENT" && m.metadata?.kind === "tool_call") {
        const callId = m.metadata.tool_call_id;
        if (callId) callIds.add(callId);
      }
    }
    return allMessages.filter(
      (m) =>
        !(
          m.senderType === "AGENT" &&
          m.metadata?.kind === "tool_result" &&
          m.metadata.tool_call_id &&
          callIds.has(m.metadata.tool_call_id)
        ),
    );
  }, [allMessages]);

  const toolResultFor = useCallback(
    (toolCallId: string) => toolResultsById.get(toolCallId),
    [toolResultsById],
  );

  const humanSenderIds = useMemo(
    () => [...new Set(messages.filter((m) => m.senderType === "USER").map((m) => m.senderId))],
    [messages],
  );
  const presenceByUser = usePresences(humanSenderIds);

  // Stream-fed run state when the stream is connected; falls back to the
  // last-message heuristic on polling (agent DMs only - group channels have
  // no reliable heuristic without the stream).
  const streamRunningAgents = useRunningAgents(channelId);
  const runningAgentIds = useMemo(() => {
    if (streamRunningAgents !== undefined) return streamRunningAgents;
    const dmFallbackRunning = channel?.isAgentDm && messages[0]?.senderType === "USER";
    return dmFallbackRunning && channel?.agentId ? [channel.agentId] : [];
  }, [streamRunningAgents, channel?.isAgentDm, channel?.agentId, messages]);
  const agentRunning = runningAgentIds.length > 0;

  const agentById = useMemo(() => {
    const map = new Map((agentsQuery.data ?? []).map((a) => [a.id, a]));
    return map;
  }, [agentsQuery.data]);

  const sheetDirectory = useMemo(
    () => [
      ...directory.subjects
        .filter((s) => s.kind === "USER")
        .map((s) => ({ ...s, kind: "USER" as const })),
      ...(agentsQuery.data ?? []).map((a) => ({ id: a.id, name: a.name, kind: "AGENT" as const })),
    ],
    [directory.subjects, agentsQuery.data],
  );

  // Snapshot the unread count on entry, before mark-as-read zeroes it out.
  const entryUnreadRef = useRef<number | null>(null);
  if (entryUnreadRef.current === null && organizationId) {
    const unreadMap = queryClient.getQueryData<Record<string, { unread: number }>>([
      "chat",
      "unread",
      organizationId,
    ]);
    entryUnreadRef.current = unreadMap?.[channelId]?.unread ?? 0;
  }

  // Anchor the "New messages" divider to the first unread message of the
  // initial load; locked once so later polls do not move it.
  const unreadAnchorRef = useRef<string | null | undefined>(undefined);
  const firstUnreadId = useMemo(() => {
    if (unreadAnchorRef.current !== undefined) return unreadAnchorRef.current;
    const loaded = messagesQuery.data;
    if (!loaded || loaded.length === 0) return null;
    const unread = entryUnreadRef.current ?? 0;
    const anchor = unread > 0 ? (loaded[Math.min(unread, loaded.length) - 1]?.id ?? null) : null;
    unreadAnchorRef.current = anchor;
    return anchor;
  }, [messagesQuery.data]);

  // Typing entries are patched into this cache by the chat stream provider;
  // the query only subscribes, it never fetches.
  const typingQuery = useQuery<TypingEntry[]>({
    queryKey: typingKey(organizationId ?? "", channelId),
    queryFn: () => [],
    enabled: false,
    staleTime: Infinity,
  });
  // Agents surface through the running-agents row, not the human typing text.
  const typingHumans = useMemo(
    () => (typingQuery.data ?? []).filter((t) => !t.isAgent && t.id !== user?.id),
    [typingQuery.data, user?.id],
  );

  const lastTypingSentRef = useRef(0);
  useEffect(() => {
    if (!draft || !organizationId) return;
    const now = Date.now();
    if (now - lastTypingSentRef.current < 3000) return;
    lastTypingSentRef.current = now;
    chatApi.setTyping({ organizationId, channelId }).catch(() => {});
  }, [draft, organizationId, channelId]);

  const title = useMemo(() => {
    if (!channel) return "Channel";
    return resolveChannelTitle(channel, membersQuery.data, user?.id ?? "");
  }, [channel, membersQuery.data, user?.id]);

  const subtitle = channel
    ? channel.channelType === "DIRECT"
      ? "Direct message"
      : `${channel.memberCount} ${channel.memberCount === 1 ? "member" : "members"}`
    : undefined;

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

  const newestId = messages[0]?.id;
  useEffect(() => {
    if (newestId && !newestId.startsWith("optimistic-")) {
      markRead.mutate(newestId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newestId]);

  // A reference picked in the @ overlay is inserted at the cursor as @label.
  // Focus-guarded: the thread screen stacks on top with its own composer.
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

  const resetCompose = useCallback(() => {
    setDraft("");
    mentionsRef.current = [];
    setReplyTo(null);
    setEditing(null);
  }, []);

  const handleSend = useCallback(() => {
    const text = draft.trim();
    if (editing) {
      if (!text) return;
      const content = toCanonical(draft, mentionsRef.current);
      editMessage.mutate({ messageId: editing.id, content });
      resetCompose();
      return;
    }
    const attachmentFileIds = attachments.readyFileIds;
    if (!text && attachmentFileIds.length === 0) return;
    const content = toCanonical(draft, mentionsRef.current);
    const replyId = replyTo?.id;
    resetCompose();
    attachments.clear();
    sendMessage.mutate({ content, replyToId: replyId, attachmentFileIds });
  }, [draft, editing, replyTo, attachments, sendMessage, editMessage, resetCompose]);

  const handleReact = useCallback(
    (message: SerializedMessage, emoji: string) => {
      const existing = message.reactions.find((r) => r.emoji === emoji);
      toggleReaction.mutate({
        messageId: message.id,
        emoji,
        add: !existing?.currentUserReacted,
      });
    },
    [toggleReaction],
  );

  const startEdit = useCallback((message: SerializedMessage) => {
    const { display } = parseMentions(message.content);
    setEditing(message);
    setReplyTo(null);
    setDraft(display);
    setTimeout(() => inputRef.current?.focus(), 60);
  }, []);

  const startReply = useCallback((message: SerializedMessage) => {
    setReplyTo(message);
    setEditing(null);
    setTimeout(() => inputRef.current?.focus(), 60);
  }, []);

  const discardFailed = useDiscardFailedMessage(channelId);

  const promptFailedSend = useCallback(
    (message: SerializedMessage) => {
      Alert.alert("Message not sent", undefined, [
        { text: "Cancel", style: "cancel" },
        { text: "Discard", style: "destructive", onPress: () => discardFailed(message.id) },
        {
          text: "Retry",
          onPress: () => {
            discardFailed(message.id);
            sendMessage.mutate({
              content: message.content,
              replyToId: message.replyToId ?? undefined,
              attachmentFileIds: message.metadata?.attachmentIds
                ? message.metadata.attachmentIds.split(",")
                : undefined,
            });
          },
        },
      ]);
    },
    [discardFailed, sendMessage],
  );

  const openThread = useCallback(
    (rootMessageId: string) => {
      router.push(`/chat/thread/${rootMessageId}?channelId=${channelId}` as never);
    },
    [channelId],
  );

  // In the inverted list an item grows and shrinks from its TOP edge (the
  // older side), so an expanding tool payload explodes upward and a collapse
  // strands the viewport. Shifting the offset by the payload height keeps the
  // card header anchored: expand unfolds downward, collapse folds back up.
  const listRef = useRef<FlatList<SerializedMessage>>(null);
  const scrollOffsetRef = useRef(0);
  const adjustScrollForDetails = useCallback((delta: number) => {
    requestAnimationFrame(() => {
      listRef.current?.scrollToOffset({
        offset: Math.max(0, scrollOffsetRef.current + delta),
        animated: false,
      });
    });
  }, []);

  const renderItem = useCallback(
    ({ item, index }: { item: SerializedMessage; index: number }) => {
      const older = messages[index + 1];
      const newDay = !older || !isSameDay(item.createdAtSeconds, older.createdAtSeconds);
      const showHeader =
        newDay ||
        older.senderId !== item.senderId ||
        item.createdAtSeconds - older.createdAtSeconds > GROUP_WINDOW_SECONDS;
      return (
        <View>
          {newDay ? <DaySeparator label={formatDayLabel(item.createdAtSeconds)} T={T} /> : null}
          {item.id === firstUnreadId ? <UnreadDivider T={T} /> : null}
          <MessageRow
            message={item}
            T={T}
            organizationId={organizationId ?? ""}
            showHeader={showHeader}
            isOwn={item.senderId === user?.id}
            senderPresence={
              item.senderType === "USER" ? (presenceByUser[item.senderId] ?? "offline") : null
            }
            agentActive={agentRunning}
            agentEmoji={
              item.senderType === "AGENT"
                ? (agentById.get(item.senderId)?.avatarEmoji ?? null)
                : null
            }
            agentName={
              item.senderType === "AGENT" ? (agentById.get(item.senderId)?.name ?? null) : null
            }
            toolResultFor={toolResultFor}
            onLongPress={() => setActionMessage(item)}
            onPressFailed={() => promptFailedSend(item)}
            onPressThread={() => openThread(item.id)}
            onToggleReaction={(emoji) => handleReact(item, emoji)}
            onDetailsToggled={adjustScrollForDetails}
          />
        </View>
      );
    },
    [
      messages,
      T,
      user?.id,
      organizationId,
      handleReact,
      firstUnreadId,
      promptFailedSend,
      agentRunning,
      agentById,
      toolResultFor,
      openThread,
      adjustScrollForDetails,
      presenceByUser,
    ],
  );

  if (channelQuery.isLoading) {
    return (
      <View style={[styles.container, { backgroundColor: T.pageBg }]}>
        <DomainHeader title="Chat" color={T.accent} icon="chat" />
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color={T.accent} />
        </View>
      </View>
    );
  }

  const canSend =
    !attachments.uploading && (!!draft.trim() || (!editing && attachments.readyFileIds.length > 0));

  return (
    <View style={[styles.container, { backgroundColor: T.pageBg, paddingBottom: barSpace }]}>
      <DomainHeader
        title={title}
        subtitle={subtitle}
        color={T.accent}
        icon="chat"
        rightActions={
          <>
            {callsAvailable && channel && !channel.isAgentDm ? (
              <TouchableOpacity
                onPress={() => (inCallHere ? setMinimized(false) : setPrejoinOpen(true))}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityRole="button"
                accessibilityLabel={activeCall ? "Join live call" : "Start call"}
              >
                {activeCall ? (
                  <View style={styles.liveCallAction}>
                    <Phone size={18} color={T.green} weight="fill" />
                    <Text style={[styles.liveCallCount, { color: T.green }]}>
                      {activeCall.participants.length}
                    </Text>
                  </View>
                ) : (
                  <Phone size={18} color={T.textDim} weight="bold" />
                )}
              </TouchableOpacity>
            ) : null}
            {channel?.isAgentDm && channel.agentId ? (
              <TouchableOpacity
                onPress={() => setContextAgentId(channel.agentId)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityRole="button"
                accessibilityLabel="Agent context usage"
              >
                <Gauge size={18} color={T.textDim} weight="bold" />
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity
              onPress={() => setPinnedOpen(true)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <PushPin size={18} color={T.textDim} weight="bold" />
            </TouchableOpacity>
            {channel ? (
              <TouchableOpacity
                onPress={() => setDetailsOpen(true)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <ChannelTypeBadge channel={channel} T={T} />
              </TouchableOpacity>
            ) : null}
          </>
        }
      />

      {messagesQuery.isLoading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color={T.accent} />
        </View>
      ) : messages.length === 0 ? (
        channel?.isAgentDm ? (
          <View style={styles.emptyWrap}>
            <Robot size={40} color={T.accent} weight="duotone" />
            <Text style={[styles.emptyTitle, { color: T.textBright }]}>
              {(channel.agentId && agentById.get(channel.agentId)?.name) || title}
            </Text>
            <Text style={[styles.emptySub, { color: T.textDim }]}>
              {(channel.agentId && agentById.get(channel.agentId)?.description) ||
                "Ask anything - replies land here as chat messages"}
            </Text>
          </View>
        ) : (
          <View style={styles.emptyWrap}>
            <ChatCircle size={40} color={T.accent} weight="duotone" />
            <Text style={[styles.emptyTitle, { color: T.textBright }]}>No messages yet</Text>
            <Text style={[styles.emptySub, { color: T.textDim }]}>
              Say hello to start the conversation
            </Text>
          </View>
        )
      ) : (
        <FlatList
          ref={listRef}
          style={styles.list}
          data={messages}
          renderItem={renderItem}
          keyExtractor={(item) => item.id}
          onScroll={(e) => (scrollOffsetRef.current = e.nativeEvent.contentOffset.y)}
          scrollEventThrottle={16}
          inverted
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.listContent}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          onEndReached={() => void messagesQuery.loadOlder()}
          onEndReachedThreshold={0.4}
          ListFooterComponent={
            messagesQuery.isLoadingOlder ? (
              <View style={styles.loadOlderWrap}>
                <ActivityIndicator size="small" color={T.accent} />
              </View>
            ) : null
          }
        />
      )}

      {(approvalsQuery.data ?? []).map((approval) => (
        <AgentApprovalCard
          key={approval.requestId}
          approval={approval}
          T={T}
          isActor={approval.actorUserId === user?.id}
          responding={respondToConfirmation.isPending}
          onRespond={(approve) =>
            respondToConfirmation.mutate({
              messageId: approval.messageId,
              requestId: approval.requestId,
              approve,
            })
          }
        />
      ))}

      {callsAvailable && activeCall && !inCallHere ? (
        <TouchableOpacity
          style={[styles.stopPill, { backgroundColor: T.surface, borderColor: T.green }]}
          onPress={() => setPrejoinOpen(true)}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="Join the live call"
        >
          <Phone size={14} color={T.green} weight="fill" />
          <Text style={[styles.stopText, { color: T.text }]}>
            Join call · {activeCall.participants.length}{" "}
            {activeCall.participants.length === 1 ? "person" : "people"}
          </Text>
        </TouchableOpacity>
      ) : null}

      {replyTo || editing ? (
        <ComposeBanner
          T={T}
          mode={editing ? "edit" : "reply"}
          message={(editing ?? replyTo)!}
          onCancel={resetCompose}
        />
      ) : null}

      <TypingIndicator
        agentIds={runningAgentIds}
        humans={typingHumans}
        onStopAgents={(ids) => ids.forEach((agentId) => stopAgent.mutate({ channelId, agentId }))}
      />

      <ChatComposer
        T={T}
        inputRef={inputRef}
        draft={draft}
        onChangeDraft={setDraft}
        onSelectionChange={(e) => (selectionRef.current = e.nativeEvent.selection)}
        placeholder={editing ? "Edit message" : `Message ${title}`}
        canSend={canSend}
        editing={!!editing}
        onSend={handleSend}
        tools={{
          onEmoji: () => setEmojiTarget("compose"),
          onMention: () => openAt(true),
          onAttach: attachments.handleAttach,
          onWrap: wrapSelection,
        }}
        attachments={attachments.pending}
        onRemoveAttachment={attachments.remove}
      />

      <MessageActionSheet
        message={actionMessage}
        T={T}
        isOwn={actionMessage?.senderId === user?.id}
        onClose={() => setActionMessage(null)}
        onReact={(emoji) => {
          if (actionMessage) handleReact(actionMessage, emoji);
          setActionMessage(null);
        }}
        onMoreEmojis={() => {
          const msg = actionMessage;
          setActionMessage(null);
          if (msg) setEmojiTarget(msg);
        }}
        onReply={() => {
          if (actionMessage) startReply(actionMessage);
          setActionMessage(null);
        }}
        onThread={() => {
          const msg = actionMessage;
          setActionMessage(null);
          if (msg) openThread(msg.rootId ?? msg.id);
        }}
        onPin={() => {
          const msg = actionMessage;
          setActionMessage(null);
          if (msg) pinMessage.mutate({ messageId: msg.id, pin: !msg.isPinned });
        }}
        onEdit={() => {
          const msg = actionMessage;
          setActionMessage(null);
          if (msg) startEdit(msg);
        }}
        onCopy={async () => {
          if (actionMessage) {
            const { display } = parseMentions(actionMessage.content);
            await Clipboard.setStringAsync(display);
          }
          setActionMessage(null);
        }}
        onDelete={() => {
          const msg = actionMessage;
          setActionMessage(null);
          if (!msg) return;
          Alert.alert("Delete message", "This cannot be undone.", [
            { text: "Cancel", style: "cancel" },
            { text: "Delete", style: "destructive", onPress: () => deleteMessage.mutate(msg.id) },
          ]);
        }}
      />

      <EmojiPickerSheet
        visible={emojiTarget !== null}
        T={T}
        onClose={() => setEmojiTarget(null)}
        onPick={(emoji) => {
          if (emojiTarget === "compose") {
            insertAtCursor(emoji, false);
          } else if (emojiTarget) {
            handleReact(emojiTarget, emoji);
          }
          setEmojiTarget(null);
        }}
      />

      <PinnedMessagesSheet
        visible={pinnedOpen}
        T={T}
        pinned={pinnedQuery.data ?? []}
        loading={pinnedQuery.isLoading}
        onClose={() => setPinnedOpen(false)}
        onUnpin={(messageId) => pinMessage.mutate({ messageId, pin: false })}
      />

      {channel ? (
        <ChannelDetailsSheet
          visible={detailsOpen}
          T={T}
          channel={channel}
          members={membersQuery.data ?? []}
          categories={categoriesQuery.data ?? []}
          currentUserId={user?.id ?? ""}
          directory={sheetDirectory}
          onClose={() => setDetailsOpen(false)}
          onRename={(name) =>
            channel.isAgentDm ? renameAgentChat.mutate(name) : updateChannel.mutate({ name })
          }
          onSetNotificationLevel={(level) =>
            updateChannelMember.mutate({ userId: user?.id ?? "", notificationLevel: level })
          }
          onMute={(untilSeconds) =>
            updateChannelMember.mutate({
              userId: user?.id ?? "",
              isMuted: true,
              mutedUntilSeconds: untilSeconds ?? undefined,
            })
          }
          onUnmute={() => updateChannelMember.mutate({ userId: user?.id ?? "", isMuted: false })}
          onAddMembers={(subjects) => addMembers.mutate(subjects)}
          onRemoveMember={(subject) => removeMembers.mutate([subject])}
          onShowAgentContext={(agentId) => {
            setDetailsOpen(false);
            setContextAgentId(agentId);
          }}
          onMoveToCategory={(categoryId) => moveChannelToCategory.mutate({ channelId, categoryId })}
          onArchive={() => {
            setDetailsOpen(false);
            archiveChannel.mutate(channelId, { onSuccess: () => router.back() });
          }}
          onDelete={() => {
            setDetailsOpen(false);
            deleteChannel.mutate(channelId, { onSuccess: () => router.back() });
          }}
          onLeave={() => {
            setDetailsOpen(false);
            leaveChannel.mutate(channelId, { onSuccess: () => router.back() });
          }}
        />
      ) : null}

      {contextAgentId ? (
        <AgentContextSheet
          visible={!!contextAgentId}
          T={T}
          channelId={channelId}
          agentId={contextAgentId}
          agentName={
            agentById.get(contextAgentId)?.name ??
            membersQuery.data?.find((m) => m.subjectId === contextAgentId)?.displayName
          }
          onClose={() => setContextAgentId(null)}
        />
      ) : null}

      <PreJoinSheet
        visible={prejoinOpen}
        T={T}
        channelId={channelId}
        channelName={title}
        callId={activeCall?.id}
        onClose={() => setPrejoinOpen(false)}
      />
    </View>
  );
}

function PinnedMessagesSheet({
  visible,
  T,
  pinned,
  loading,
  onClose,
  onUnpin,
}: {
  visible: boolean;
  T: ThemeColors;
  pinned: SerializedMessage[];
  loading: boolean;
  onClose: () => void;
  onUnpin: (messageId: string) => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />
      <View style={[styles.sheet, { backgroundColor: T.surface }]}>
        <View style={[styles.handle, { backgroundColor: T.border }]} />
        <View style={styles.pinnedHeader}>
          <PushPin size={16} color={T.accent} weight="fill" />
          <Text style={[styles.pinnedTitle, { color: T.textBright }]}>Pinned messages</Text>
        </View>
        {loading ? (
          <View style={styles.pinnedLoading}>
            <ActivityIndicator size="small" color={T.accent} />
          </View>
        ) : pinned.length === 0 ? (
          <Text style={[styles.pinnedEmpty, { color: T.textDim }]}>No pinned messages</Text>
        ) : (
          <ScrollView style={styles.pinnedList}>
            {pinned.map((msg) => {
              const { display } = parseMentions(msg.content);
              return (
                <View key={msg.id} style={[styles.pinnedRow, { borderTopColor: T.border }]}>
                  <View style={{ flex: 1 }}>
                    <View style={styles.pinnedRowHeader}>
                      <Text
                        style={[styles.pinnedSender, { color: T.textBright }]}
                        numberOfLines={1}
                      >
                        {msg.senderName}
                      </Text>
                      <Text style={[styles.pinnedTime, { color: T.textDim }]}>{msg.timeLabel}</Text>
                    </View>
                    <Text style={[styles.pinnedContent, { color: T.text }]} numberOfLines={2}>
                      {display}
                    </Text>
                  </View>
                  <TouchableOpacity
                    onPress={() => onUnpin(msg.id)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <PushPinSlash size={16} color={T.textDim} weight="duotone" />
                  </TouchableOpacity>
                </View>
              );
            })}
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}

function ComposeBanner({
  T,
  mode,
  message,
  onCancel,
}: {
  T: ThemeColors;
  mode: "reply" | "edit";
  message: SerializedMessage;
  onCancel: () => void;
}) {
  const { display } = useMemo(() => parseMentions(message.content), [message.content]);
  return (
    <View style={[styles.banner, { backgroundColor: T.surface, borderTopColor: T.border }]}>
      <View style={[styles.bannerAccent, { backgroundColor: T.accent }]} />
      <View style={{ flex: 1 }}>
        <Text style={[styles.bannerLabel, { color: T.accent }]}>
          {mode === "edit" ? "Editing message" : `Replying to ${message.senderName}`}
        </Text>
        <Text style={[styles.bannerText, { color: T.textDim }]} numberOfLines={1}>
          {display}
        </Text>
      </View>
      <TouchableOpacity onPress={onCancel} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
        <X size={18} color={T.textDim} weight="bold" />
      </TouchableOpacity>
    </View>
  );
}

function ChannelTypeBadge({
  channel,
  T,
}: {
  channel: { channelType: string; isAgentDm: boolean };
  T: ThemeColors;
}) {
  const Icon = channel.isAgentDm
    ? Robot
    : channel.channelType === "PRIVATE"
      ? Lock
      : channel.channelType === "DIRECT" || channel.channelType === "GROUP_DM"
        ? ChatCircle
        : Hash;
  return <Icon size={18} color={T.textDim} weight="bold" />;
}

function DaySeparator({ label, T }: { label: string; T: ThemeColors }) {
  return (
    <View style={styles.separatorRow}>
      <View style={[styles.separatorLine, { backgroundColor: T.border }]} />
      <Text style={[styles.daySepLabel, { color: T.textDim }]}>{label}</Text>
      <View style={[styles.separatorLine, { backgroundColor: T.border }]} />
    </View>
  );
}

function UnreadDivider({ T }: { T: ThemeColors }) {
  return (
    <View style={styles.separatorRow}>
      <View style={[styles.separatorLine, { backgroundColor: T.accent }]} />
      <Text style={[styles.unreadLabel, { color: T.accent }]}>New messages</Text>
      <View style={[styles.separatorLine, { backgroundColor: T.accent }]} />
    </View>
  );
}

function MessageRow({
  message,
  T,
  organizationId,
  showHeader,
  isOwn,
  agentActive,
  agentEmoji,
  agentName,
  toolResultFor,
  onLongPress,
  onPressFailed,
  onPressThread,
  onToggleReaction,
  onDetailsToggled,
  senderPresence,
}: {
  message: SerializedMessage;
  T: ThemeColors;
  organizationId: string;
  showHeader: boolean;
  isOwn: boolean;
  agentActive: boolean;
  agentEmoji?: string | null;
  agentName?: string | null;
  toolResultFor: (toolCallId: string) => SerializedMessage | undefined;
  onLongPress: () => void;
  onPressFailed: () => void;
  onPressThread: () => void;
  onToggleReaction: (emoji: string) => void;
  onDetailsToggled?: (heightDelta: number) => void;
  senderPresence?: string | null;
}) {
  const { display } = useMemo(() => parseMentions(message.content), [message.content]);
  const isAgent = message.senderType === "AGENT";
  const senderName = (isAgent && agentName) || message.senderName;
  const isSystem = message.senderType === "SYSTEM";
  const failed = message.metadata?.failed === "1";
  const pending = message.metadata?.optimistic === "1" && !failed;
  const agentSpecial = isAgent && isSpecialAgentKind(message);
  const jumbo = useMemo(() => !agentSpecial && isEmojiOnly(display), [agentSpecial, display]);

  if (isSystem) {
    return <SystemMessage content={message.content} />;
  }

  return (
    <Pressable
      onLongPress={pending || failed ? undefined : onLongPress}
      onPress={failed ? onPressFailed : undefined}
      delayLongPress={250}
      style={[styles.msgRow, !showHeader && styles.msgRowGrouped]}
    >
      <View style={styles.msgAvatar}>
        {showHeader ? (
          <Avatar
            name={senderName}
            avatarUrl={message.senderAvatarUrl ?? undefined}
            size={36}
            accentColor={isAgent ? T.accent : undefined}
            emoji={isAgent ? (agentEmoji ?? undefined) : undefined}
            presence={senderPresence}
            presenceRingColor={T.pageBg}
          />
        ) : null}
      </View>
      <View style={styles.msgBody}>
        {showHeader ? (
          <View style={styles.msgHeader}>
            <Text style={[styles.msgSender, { color: T.textBright }]} numberOfLines={1}>
              {senderName}
            </Text>
            {isAgent ? (
              <View style={[styles.agentTag, { backgroundColor: T.accentSoft }]}>
                <Text style={[styles.agentTagText, { color: T.accent }]}>AGENT</Text>
              </View>
            ) : null}
            <Text style={[styles.msgTime, { color: T.textDim }]}>{message.timeLabel}</Text>
            {message.isPinned ? <PushPin size={11} color={T.accent} weight="fill" /> : null}
          </View>
        ) : null}
        {message.replyContext ? (
          <View style={[styles.replyContext, { borderLeftColor: T.border }]}>
            <Text style={[styles.replyContextName, { color: T.textDim }]} numberOfLines={1}>
              {message.replyContext.senderName}
            </Text>
            <Text style={[styles.replyContextText, { color: T.textDim }]} numberOfLines={1}>
              {message.replyContext.contentPreview}
            </Text>
          </View>
        ) : null}
        {agentSpecial ? (
          <AgentMessageBody
            message={message}
            T={T}
            agentActive={agentActive}
            toolResultFor={toolResultFor}
            onDetailsToggled={onDetailsToggled}
          />
        ) : jumbo ? (
          <Text style={[styles.jumboEmoji, pending && styles.pendingBody]}>{display.trim()}</Text>
        ) : display.length > 0 ? (
          <View style={pending ? styles.pendingBody : undefined}>
            <MarkdownRenderer content={message.content} />
          </View>
        ) : null}
        {message.attachments.length > 0 ? (
          <MessageAttachments
            attachments={message.attachments}
            organizationId={organizationId}
            T={T}
          />
        ) : null}
        {message.editedAtSeconds ? (
          <Text style={[styles.editedTag, { color: T.textDim }]}>(edited)</Text>
        ) : null}
        {failed ? (
          <View style={styles.failedRow}>
            <WarningCircle size={13} color={T.red} weight="fill" />
            <Text style={[styles.failedText, { color: T.red }]}>Not sent - tap for options</Text>
          </View>
        ) : null}
        {message.replyCount > 0 ? (
          <TouchableOpacity
            style={[styles.threadChip, { backgroundColor: T.accentSoft }]}
            onPress={onPressThread}
            activeOpacity={0.7}
          >
            <ChatText size={12} color={T.accent} weight="duotone" />
            <Text style={[styles.threadChipText, { color: T.accent }]}>
              {message.replyCount} {message.replyCount === 1 ? "reply" : "replies"}
            </Text>
          </TouchableOpacity>
        ) : null}
        {message.reactions.length > 0 ? (
          <View style={styles.reactionsRow}>
            {message.reactions.map((r) => (
              <TouchableOpacity
                key={r.emoji}
                style={[
                  styles.reactionChip,
                  {
                    backgroundColor: r.currentUserReacted ? T.accentSoft : T.surface,
                    borderColor: r.currentUserReacted ? T.accent : T.border,
                  },
                ]}
                onPress={() => onToggleReaction(r.emoji)}
                activeOpacity={0.7}
              >
                <Text style={styles.reactionEmoji}>{r.emoji}</Text>
                <Text
                  style={[
                    styles.reactionCount,
                    { color: r.currentUserReacted ? T.accent : T.textDim },
                  ]}
                >
                  {r.count}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

function MessageActionSheet({
  message,
  T,
  isOwn,
  onClose,
  onReact,
  onMoreEmojis,
  onReply,
  onThread,
  onPin,
  onEdit,
  onCopy,
  onDelete,
}: {
  message: SerializedMessage | null;
  T: ThemeColors;
  isOwn: boolean;
  onClose: () => void;
  onReact: (emoji: string) => void;
  onMoreEmojis: () => void;
  onReply: () => void;
  onThread: () => void;
  onPin: () => void;
  onEdit: () => void;
  onCopy: () => void;
  onDelete: () => void;
}) {
  const canEdit = isOwn && message?.senderType === "USER";
  return (
    <Modal visible={!!message} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />
      <View style={[styles.sheet, { backgroundColor: T.surface }]}>
        <View style={[styles.handle, { backgroundColor: T.border }]} />
        <View style={styles.emojiRow}>
          {QUICK_EMOJIS.map((emoji) => (
            <TouchableOpacity
              key={emoji}
              style={[styles.emojiBtn, { backgroundColor: T.bg }]}
              onPress={() => onReact(emoji)}
              activeOpacity={0.7}
            >
              <Text style={styles.emojiText}>{emoji}</Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity
            style={[styles.emojiBtn, { backgroundColor: T.bg }]}
            onPress={onMoreEmojis}
            activeOpacity={0.7}
          >
            <Smiley size={22} color={T.textDim} weight="regular" />
          </TouchableOpacity>
        </View>
        <SheetAction
          T={T}
          onPress={onReply}
          icon={<ArrowBendUpLeft size={18} color={T.text} weight="duotone" />}
          label="Reply"
        />
        <SheetAction
          T={T}
          onPress={onThread}
          icon={<ChatText size={18} color={T.text} weight="duotone" />}
          label={message?.replyCount ? "Open thread" : "Reply in thread"}
        />
        <SheetAction
          T={T}
          onPress={onPin}
          icon={
            message?.isPinned ? (
              <PushPinSlash size={18} color={T.text} weight="duotone" />
            ) : (
              <PushPin size={18} color={T.text} weight="duotone" />
            )
          }
          label={message?.isPinned ? "Unpin message" : "Pin message"}
        />
        {canEdit ? (
          <SheetAction
            T={T}
            onPress={onEdit}
            icon={<PencilSimple size={18} color={T.text} weight="duotone" />}
            label="Edit message"
          />
        ) : null}
        <SheetAction
          T={T}
          onPress={onCopy}
          icon={<Copy size={18} color={T.text} weight="duotone" />}
          label="Copy text"
        />
        {isOwn ? (
          <SheetAction
            T={T}
            onPress={onDelete}
            icon={<Trash size={18} color="#FA5252" weight="duotone" />}
            label="Delete message"
            danger
          />
        ) : null}
      </View>
    </Modal>
  );
}

function SheetAction({
  T,
  onPress,
  icon,
  label,
  danger,
}: {
  T: ThemeColors;
  onPress: () => void;
  icon: React.ReactNode;
  label: string;
  danger?: boolean;
}) {
  return (
    <TouchableOpacity style={[styles.sheetAction, { borderTopColor: T.border }]} onPress={onPress}>
      {icon}
      <Text style={[styles.sheetActionText, { color: danger ? "#FA5252" : T.textBright }]}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  loadingWrap: { flex: 1, alignItems: "center", justifyContent: "center" },
  emptyWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 40,
  },
  emptyTitle: { fontSize: 16, fontFamily: FONT.semibold, marginTop: 4 },
  emptySub: { fontSize: 13, fontFamily: FONT.regular, textAlign: "center" },
  list: { flex: 1 },
  listContent: { paddingVertical: 12 },
  loadOlderWrap: { paddingVertical: 14, alignItems: "center" },
  msgRow: { flexDirection: "row", gap: 10, paddingHorizontal: 16, paddingTop: 10 },
  msgRowGrouped: { paddingTop: 1 },
  msgAvatar: { width: 36 },
  msgBody: { flex: 1, gap: 3 },
  msgHeader: { flexDirection: "row", alignItems: "center", gap: 7 },
  msgSender: { fontSize: 14, fontFamily: FONT.semibold, flexShrink: 1 },
  agentTag: { paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4 },
  agentTagText: { fontSize: 9, fontFamily: FONT.bold, letterSpacing: 0.4 },
  msgTime: { fontSize: 11, fontFamily: FONT.regular },
  editedTag: { fontSize: 11, fontFamily: FONT.regular },
  jumboEmoji: { fontSize: 40, lineHeight: 48, paddingVertical: 2 },
  pendingBody: { opacity: 0.55 },
  failedRow: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 3 },
  failedText: { fontSize: 12, fontFamily: FONT.medium },
  separatorRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  separatorLine: { flex: 1, height: StyleSheet.hairlineWidth },
  daySepLabel: {
    fontSize: 11,
    fontFamily: FONT.medium,
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  unreadLabel: { fontSize: 12, fontFamily: FONT.semibold },
  replyContext: {
    borderLeftWidth: 2,
    paddingLeft: 8,
    paddingVertical: 1,
    marginBottom: 2,
  },
  replyContextName: { fontSize: 12, fontFamily: FONT.semibold },
  replyContextText: { fontSize: 12, fontFamily: FONT.regular },
  reactionsRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 4 },
  reactionChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  reactionEmoji: { fontSize: 13 },
  reactionCount: { fontSize: 12, fontFamily: FONT.semibold },
  stopPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "center",
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: 8,
  },
  stopText: { fontSize: 13, fontFamily: FONT.semibold },
  liveCallAction: { flexDirection: "row", alignItems: "center", gap: 3 },
  liveCallCount: { fontSize: 12, fontFamily: FONT.semibold },
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  threadChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    alignSelf: "flex-start",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    marginTop: 4,
  },
  threadChipText: { fontSize: 12, fontFamily: FONT.semibold },
  pinnedHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 20,
    paddingBottom: 10,
  },
  pinnedTitle: { fontSize: 15, fontFamily: FONT.semibold },
  pinnedLoading: { paddingVertical: 24, alignItems: "center" },
  pinnedEmpty: {
    fontSize: 13,
    fontFamily: FONT.regular,
    textAlign: "center",
    paddingVertical: 24,
  },
  pinnedList: { maxHeight: 360 },
  pinnedRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  pinnedRowHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  pinnedSender: { fontSize: 13, fontFamily: FONT.semibold, flexShrink: 1 },
  pinnedTime: { fontSize: 11, fontFamily: FONT.regular },
  pinnedContent: { fontSize: 13, fontFamily: FONT.regular, marginTop: 2 },
  bannerAccent: { width: 3, alignSelf: "stretch", borderRadius: 2 },
  bannerLabel: { fontSize: 12, fontFamily: FONT.semibold },
  bannerText: { fontSize: 12, fontFamily: FONT.regular, marginTop: 1 },
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
  emojiRow: {
    flexDirection: "row",
    justifyContent: "space-around",
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  emojiBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  emojiText: { fontSize: 22 },
  sheetAction: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: 15,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  sheetActionText: { fontSize: 15, fontFamily: FONT.medium },
});
