import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Keyboard,
  Platform,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import {
  Trash,
  Copy,
  EnvelopeSimple,
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
  CaretDown,
  CaretUp,
  WarningCircle,
  X,
  Gauge,
  Phone,
  PhoneSlash,
} from "phosphor-react-native";
import { router, useLocalSearchParams, useFocusEffect } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { useAnimatedStyle, useSharedValue } from "react-native-reanimated";
import { useReanimatedKeyboardAnimation } from "react-native-keyboard-controller";
import { DomainHeader } from "@shared/components/DomainHeader";
import { bottomBarBlockHeight } from "@shared/components/BottomNav";
import { Avatar } from "@shared/components/Avatar";
import { BottomSheet } from "@shared/components/BottomSheet";
import { ChatComposer } from "@features/chat/components/ChatComposer";
import { TypingIndicator } from "@features/chat/components/TypingIndicator";
import { EmojiPickerSheet } from "@features/chat/components/EmojiPickerSheet";
import { SwipeToReply } from "@features/chat/components/SwipeToReply";
import { MarkdownRenderer } from "@shared/components/MarkdownRenderer";
import { SystemMessage } from "@features/chat/components/SystemMessage";
import { MessageAttachments } from "@features/chat/components/MessageAttachments";
import { ThreadReplyCaption } from "@features/chat/components/ThreadReplyCaption";
import { AgentMessageBody, isSpecialAgentKind } from "@features/agents/components/AgentMessageBody";
import { ThinkingPane } from "@features/agents/components/ThinkingPane";
import { AgentApprovalCard } from "@features/agents/components/AgentApprovalCard";
import { AgentContextSheet } from "@features/agents/components/AgentContextSheet";
import { memorySubjectForChannel } from "@features/agents/memorySerializer";
import { AgentModelSheet } from "@features/chat/components/AgentModelSheet";
import { ChannelDetailsSheet } from "@features/chat/components/ChannelDetailsSheet";
import { useCall } from "@features/calls/CallContext";
import { useActiveCall } from "@features/calls/useCallsState";
import { useChannelActiveCall } from "@features/calls/useChannelActiveCall";
import { showCallsUnavailable } from "@features/calls/callsUnavailable";
import { usePresences } from "@shared/presence/usePresence";
import { useTheme } from "@shared/hooks/useTheme";
import type { ThemeColors } from "@theme/theme";
import { FONT } from "@theme/typography";
import { useAuth } from "@core/providers/AuthContext";
import { useUniffy } from "@core/providers/UniffyContext";
import {
  useChannel,
  useUnreadCounts,
  useMessages,
  useUnreadMessageWindow,
  useChannelMembers,
  useChannelPendingApprovals,
  usePinnedMessages,
  useCategories,
  useChatPolicy,
} from "@features/chat/useChat";
import {
  useSendMessage,
  useDeleteMessage,
  useToggleReaction,
  useMarkChannelRead,
  useMarkChannelUnread,
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
import { useChatLayout, type ChatLayout } from "@features/chat/chatPrefs";
import { useDirectory } from "@shared/directory/useDirectory";
import {
  useAgents,
  useAgentModels,
  useAgentTools,
  useStopAgentRun,
} from "@features/agents/useAgents";
import { persistedThinkingBlocks, type ThinkingBlockView } from "@features/agents/thinkingBlocks";
import {
  useChatStream,
  typingKey,
  useRunningAgents,
  useAgentThinking,
  type AgentThinkingBlock,
  type TypingEntry,
} from "@features/chat/useChatStream";
import { useComposerAttachments } from "@features/chat/useComposerAttachments";
import { useChannelAgentConfig } from "@features/chat/useChannelAgentConfig";
import { useChatPermissions } from "@features/chat/useChatPermissions";
import { useDraftSync } from "@features/chat/useDraftSync";
import { useJoinCallParam } from "@features/chat/useJoinCallParam";
import { useScreenFocusRef } from "@shared/hooks/useScreenFocusRef";
import { chatApi } from "@features/chat/chatApi";
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
import { buildBroadcastSuggestions } from "@features/mentions/broadcastSuggestions";
import {
  DEFAULT_BROADCAST_CONFIRM_THRESHOLD,
  broadcastMentionsIn,
  effectiveBroadcastKind,
} from "@shared/mentions/broadcastMentions";
import type { SerializedSearchResult } from "@features/search/searchSerializer";
import {
  editWindowAllows,
  resolveChannelTitle,
  type SerializedMessage,
  type SerializedReaction,
} from "@features/chat/chatSerializer";
import { EditHistorySheet } from "@features/chat/components/EditHistorySheet";
import { ReactorsSheet } from "@features/chat/components/ReactorsSheet";

const GROUP_WINDOW_SECONDS = 300;
const QUICK_EMOJIS = ["👍", "❤️", "😂", "🎉", "👀", "🙏"];
// The send path snapshots the quoted message as content[:150], so an expanded
// quote can only ever show that much of a longer original.
const REPLY_PREVIEW_MAX_CHARS = 150;
// One line's worth at the caption's size; the row truncates anything longer.
const THREAD_ROOT_PREVIEW_MAX_CHARS = 90;
const REPLY_BODY_GAP = 5;
// Offset 0 is the newest message in the inverted list. Within this much of it
// the reader counts as "at the bottom" and new rows are followed automatically,
// so sending needs no scroll of its own.
const NEAR_BOTTOM_PX = 120;
// Shared by the bubble's padding and by the width derived from measured text,
// so the two cannot drift apart and leave the last word clipped.
const BUBBLE_PAD_X = 11;
type SelectionRange = { start: number; end: number };

/** One transcript row: a message, or a folded run of that agent's tool calls. */
type MessageRowItem = {
  message: SerializedMessage;
  /** Consecutive tool calls from one agent, oldest first, rendered as one pane. */
  toolRun?: SerializedMessage[];
};

function isAgentToolCall(message: SerializedMessage): boolean {
  return message.senderType === "AGENT" && message.metadata?.kind === "tool_call";
}

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
  const chatLayout = useChatLayout();

  // The RESTING height of the composer block, and deliberately only that.
  //
  // The list's bottom inset and its negative margin are both pinned to this, so
  // neither changes when the composer grows - a focused action row, a reply
  // banner, an attachment strip, a draft wrapping onto a fifth line. The flex
  // box hands the list whatever height the footer leaves it, and an inverted
  // list pinned at offset 0 keeps its content glued to the frame's bottom edge,
  // so the transcript rides up on its own with no cell moving inside the
  // content container.
  //
  // Insetting the CONTENT to match instead re-lays out every mounted cell and
  // fires an onLayout for each, which is why a long transcript stuttered where
  // a short one looked fine. Growth is a viewport change, not a content change.
  const [restingFooterHeight, setRestingFooterHeight] = useState(0);
  const restingFooterRef = useRef(0);
  // Composer growth rides the UI thread. It changes on the same layout pass
  // that collapses the composer as the keyboard dismisses, and routing that
  // through React state re-rendered this whole screen - list props included -
  // in the middle of the close animation, which is the hitch on the way down.
  const composerGrowth = useSharedValue(0);
  // Both writes below happen in a layout callback, never while rendering: the
  // ref holds the resting height across renders, and assigning a shared value
  // is the documented way to drive a Reanimated animation from JS.
  const noteFooterHeight = useCallback(
    // eslint-disable-next-line react/react-compiler
    (height: number) => {
      const rounded = Math.round(height);
      // eslint-disable-next-line react/react-compiler
      if (restingFooterRef.current === 0 || rounded < restingFooterRef.current) {
        // eslint-disable-next-line react/react-compiler
        restingFooterRef.current = rounded;
        setRestingFooterHeight(rounded);
      }
      // eslint-disable-next-line react/react-compiler
      composerGrowth.value = Math.max(0, rounded - restingFooterRef.current);
    },
    [composerGrowth],
  );
  // The keyboard lift reaches the transcript as a transform, never as a height
  // change. The shell's spacer shrinks this screen on every frame of the
  // keyboard animation, and resizing a VirtualizedList that often re-runs Yoga
  // across every mounted row - which is the stutter. Holding the resting height
  // and sliding instead costs a composite and no layout pass at all.
  const { height: keyboardOffset, progress: keyboardProgress } = useReanimatedKeyboardAnimation();
  // The resting height is read off the screen root, not the transcript slot.
  // The slot only exists once a message does, and in an empty channel the
  // first one lands with the keyboard up: measured then, the slot is already
  // keyboard-short, and the lift below subtracts the keyboard a second time,
  // which parks every row above the top of the screen until the keyboard
  // closes. The root is mounted from entry with the keyboard down, and at
  // rest the slot fills it exactly - the header overlays it and the slot's
  // negative margin cancels the composer - so the two heights agree.
  const [transcriptHeight, setTranscriptHeight] = useState(0);
  const noteTranscriptHeight = useCallback((height: number) => {
    const rounded = Math.round(height);
    setTranscriptHeight((prev) => (rounded > prev ? rounded : prev));
  }, []);
  // The content inset reserves the RESTING composer only, so anything the
  // composer grows by - the focused action row, a reply banner, a draft wrapping
  // onto another line - would otherwise sit over the newest message. Folding
  // that growth into the same transform clears it without touching the inset,
  // which is the one thing that would relayout every mounted cell.
  const transcriptLift = useAnimatedStyle(() => {
    // The bar collapses as the keyboard rises, so the slot gives up only the
    // difference between the two, not the whole keyboard.
    const shrink = Math.max(0, -keyboardOffset.value - keyboardProgress.value * barSpace);
    return { transform: [{ translateY: -(shrink + composerGrowth.value) }] };
  });

  const { user, organizationId } = useAuth();
  const { pendingReference, clearPendingReference, openAt } = useUniffy();

  useChatStream();
  const channelQuery = useChannel(channelId);
  const unreadQuery = useUnreadCounts();
  const manualUnreadRef = useRef(false);
  const landedOnUnreadRef = useRef(false);
  const [entryVisit, setEntryVisit] = useState(0);
  const entryKey = `${organizationId ?? ""}:${user?.id ?? ""}:${channelId}:${entryVisit}`;
  const [entryUnread, setEntryUnread] = useState<{ key: string; target: string | null } | null>(
    null,
  );
  // A manual unread holds for the whole visit: coming back from a pushed
  // thread refocuses this screen, and that is not a reopen.
  useEffect(() => {
    manualUnreadRef.current = false;
  }, [channelId]);
  useEffect(() => {
    if (!organizationId || !unreadQuery.data || entryUnread?.key === entryKey) return;
    landedOnUnreadRef.current = false;
    const unread = unreadQuery.data[channelId];
    // Capture once when this channel's unread snapshot becomes available.
    // eslint-disable-next-line react/react-compiler
    setEntryUnread({
      key: entryKey,
      target: unread?.unread ? (unread.firstUnreadMessageId ?? null) : null,
    });
  }, [organizationId, channelId, entryKey, entryUnread?.key, unreadQuery.data]);
  const entryReady = entryUnread?.key === entryKey;
  const firstUnreadId = entryReady ? entryUnread.target : null;

  const messageHead = useMessages(channelId);
  const messagesQuery = useUnreadMessageWindow(
    channelId,
    { key: entryKey, target: firstUnreadId, ready: entryReady },
    messageHead,
  );
  const membersQuery = useChannelMembers(channelId);
  const approvalsQuery = useChannelPendingApprovals(channelId, true);
  const sendMessage = useSendMessage(channelId);
  const deleteMessage = useDeleteMessage(channelId);
  const toggleReaction = useToggleReaction(channelId);
  const editMessage = useEditMessage(channelId);
  const pinMessage = usePinMessage(channelId);
  const markRead = useMarkChannelRead(channelId);
  const markUnread = useMarkChannelUnread(channelId);
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
  // Fills the label store the tool panes subscribe to; nothing here renders it.
  useAgentTools();
  const { canManageChat } = useChatPermissions();

  const [draft, setDraft] = useState("");
  const mentionsRef = useRef<MentionEntry[]>([]);
  // Edit mode borrows the composer; the unsent draft is stashed so exiting
  // edit restores it instead of leaving "" for the autosaver to sync as a delete.
  const preEditStashRef = useRef<{ draft: string; mentions: MentionEntry[] } | null>(null);
  const selectionRef = useRef<SelectionRange>({ start: 0, end: 0 });
  const inputRef = useRef<TextInput>(null);
  // Cursor mirrored into state so the @-typeahead recomputes per keystroke;
  // the ref alone would never re-render the suggestion bar.
  const [cursor, setCursor] = useState(0);
  const chatPolicy = useChatPolicy().data;
  // The server enforces the same gate on send; hiding the suggestions is UX.
  const canBroadcast = useMemo(() => {
    const c = channelQuery.data;
    if (!c || c.channelType === "DIRECT" || c.isAgentDm) return false;
    if (!chatPolicy || chatPolicy.minRole === "member") return true;
    if (canManageChat) return true;
    return c.currentUserRole === "OWNER" || c.currentUserRole === "ADMIN";
  }, [channelQuery.data, chatPolicy, canManageChat]);
  const broadcastSuggestions = useMemo(
    () => (canBroadcast ? buildBroadcastSuggestions() : undefined),
    [canBroadcast],
  );
  const mentionTypeahead = useMentionTypeahead(draft, cursor, broadcastSuggestions);
  const [actionMessage, setActionMessage] = useState<SerializedMessage | null>(null);
  const [actionEditAllowed, setActionEditAllowed] = useState(false);
  const [historyMessage, setHistoryMessage] = useState<SerializedMessage | null>(null);
  const [replyTo, setReplyTo] = useState<SerializedMessage | null>(null);
  const [editing, setEditing] = useState<SerializedMessage | null>(null);
  const [emojiTarget, setEmojiTarget] = useState<SerializedMessage | "compose" | null>(null);
  const [pinnedOpen, setPinnedOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [modelSheetOpen, setModelSheetOpen] = useState(false);
  const [contextAgentId, setContextAgentId] = useState<string | null>(null);
  const {
    session: callSession,
    setMinimized,
    available: callsAvailable,
    callsDisabledMessage,
    openPrejoin,
  } = useCall();
  useChannelActiveCall(channelId);
  const activeCall = useActiveCall(channelId);
  const inCallHere = callSession.channelId === channelId && callSession.status !== "idle";
  // The pre-join resolves the channel name and the live call itself, so every
  // entry point here only has to say which channel.
  const openChannelPrejoin = useCallback(
    () => openPrejoin({ channelId }),
    [openPrejoin, channelId],
  );
  useJoinCallParam(channelId, openChannelPrejoin);
  const attachments = useComposerAttachments();
  const screenFocused = useScreenFocusRef();

  const pinnedQuery = usePinnedMessages(channelId, pinnedOpen);

  const allMessages = useMemo(() => messagesQuery.data ?? [], [messagesQuery.data]);
  const channel = channelQuery.data;

  // Mirrors the backend gate on compacting/resetting an agent's context: a DM
  // member may do it freely, every other channel type needs an elevated role.
  const canModerateChannel = useMemo(() => {
    if (!channel) return false;
    if (channel.channelType === "DIRECT" || channel.channelType === "GROUP_DM") return true;
    if (canManageChat) return true;
    return channel.currentUserRole === "OWNER" || channel.currentUserRole === "ADMIN";
  }, [channel, canManageChat]);

  const memorySubject = useMemo(
    () => memorySubjectForChannel(channel, channelId),
    [channel, channelId],
  );
  // Channel memory only exists where an agent can act, so the entry point
  // follows agent membership rather than showing on every conversation.
  const hasAgentMemory =
    !!channel &&
    (channel.isAgentDm || (membersQuery.data ?? []).some((m) => m.subjectType === "AGENT"));
  const isMemoryModerator =
    canManageChat || channel?.currentUserRole === "OWNER" || channel?.currentUserRole === "ADMIN";

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

  // Roots quoted by the caption on a thread reply's channel copy. Built only
  // when such a copy is on screen, so an ordinary channel pays nothing, and
  // holding only the quoted roots keeps it small in one that has many.
  const threadRootContentById = useMemo(() => {
    const wanted = new Set<string>();
    for (const m of messages) {
      if (m.threadReplyContext) wanted.add(m.threadReplyContext.rootMessageId);
    }
    if (wanted.size === 0) return null;
    const map = new Map<string, string>();
    for (const m of messages) {
      if (wanted.has(m.id)) map.set(m.id, m.content);
    }
    return map;
  }, [messages]);

  // A run of consecutive tool calls from one agent is one activity pane rather
  // than one row per call. The transcript is newest-first, so a run is walked
  // backwards and anchored on its OLDEST row - that is the one whose header
  // renders at the top of the group.
  const rows = useMemo(() => {
    const out: MessageRowItem[] = [];
    for (let i = 0; i < messages.length; i++) {
      const message = messages[i];
      if (!isAgentToolCall(message)) {
        out.push({ message });
        continue;
      }
      let oldest = i;
      while (
        oldest + 1 < messages.length &&
        isAgentToolCall(messages[oldest + 1]) &&
        messages[oldest + 1].senderId === message.senderId
      ) {
        oldest++;
      }
      out.push({ message: messages[oldest], toolRun: messages.slice(i, oldest + 1).reverse() });
      i = oldest;
    }
    return out;
  }, [messages]);

  // Only used to attribute an agent context reset, which stamps a user id but
  // not always a name.
  const [reactorsTarget, setReactorsTarget] = useState<SerializedReaction | null>(null);

  const resolveUserName = useCallback(
    (userId: string) => {
      if (!userId) return undefined;
      if (userId === user?.id) return "you";
      return (
        directory.byId.get(userId)?.name ??
        membersQuery.data?.find((m) => m.subjectId === userId)?.displayName
      );
    },
    [user?.id, directory.byId, membersQuery.data],
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
  const thinkingByMessage = useAgentThinking(channelId);
  // Keyed on the two channel fields it reads rather than the channel object: a
  // refetch that changes the object identity would otherwise hand every consumer
  // a fresh array and cost them their own memoization.
  // eslint-disable-next-line react/react-compiler
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

  const dmAgentId = channel?.isAgentDm ? (channel.agentId ?? "") : "";
  const dmAgent = dmAgentId ? agentById.get(dmAgentId) : undefined;
  const agentConfigQuery = useChannelAgentConfig(channelId, dmAgentId, !!dmAgentId);
  const dmModelOverride = agentConfigQuery.data?.modelOverride ?? "";
  // Shares its cache entry with the model sheet, so naming the active model in
  // the composer costs no extra request.
  const dmModelsQuery = useAgentModels(dmAgent?.primaryProviderKeyId ?? "", !!dmAgentId);
  const dmModelLabel = useMemo(() => {
    const active = dmModelOverride || dmAgent?.primaryModel || "";
    if (!active) return "Default";
    return dmModelsQuery.data?.find((m) => m.id === active)?.displayName || active;
  }, [dmModelOverride, dmAgent?.primaryModel, dmModelsQuery.data]);

  const sheetDirectory = useMemo(
    () => [
      ...directory.subjects
        .filter((s) => s.kind === "USER")
        .map((s) => ({ ...s, kind: "USER" as const })),
      ...(agentsQuery.data ?? []).map((a) => ({ id: a.id, name: a.name, kind: "AGENT" as const })),
    ],
    [directory.subjects, agentsQuery.data],
  );

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

  const { flushOnSend } = useDraftSync({
    channelId,
    draft,
    setDraft,
    mentionsRef,
    editing: !!editing,
  });

  const dmPeer = useMemo(() => {
    if (!channel || channel.isAgentDm || channel.channelType !== "DIRECT") return null;
    const peerId = channel.dmMemberIds.find((id) => id !== user?.id);
    if (!peerId) return null;
    const member = membersQuery.data?.find((m) => m.subjectId === peerId);
    const subject = directory.byId.get(peerId);
    const name = member?.displayName || subject?.name || "";
    if (!name) return null;
    return { name, avatarUrl: member?.avatarUrl ?? subject?.avatarUrl ?? undefined };
  }, [channel, membersQuery.data, directory.byId, user?.id]);

  // An agent run stamps every turn it writes with the trigger message as its
  // reply target (see the agent runtime writers), so in an agent chat the quote
  // repeats the message directly above on every single turn. A human reply_to_id
  // is only ever set by someone deliberately replying, so those always show.
  const hideReplyContext = channel?.isAgentDm ?? false;

  const title = useMemo(() => {
    if (!channel) return "Channel";
    if (dmPeer) return dmPeer.name;
    return resolveChannelTitle(channel, membersQuery.data, user?.id ?? "");
  }, [channel, dmPeer, membersQuery.data, user?.id]);

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

  // Holds off the newest-id auto-mark-read after the user marks something
  // unread, or the badge they just asked for clears on the next poll.

  const newestId = messages[0]?.id;
  useEffect(() => {
    if (
      !entryReady ||
      messagesQuery.blocksRead ||
      !screenFocused.current ||
      manualUnreadRef.current
    )
      return;
    if (newestId && !newestId.startsWith("optimistic-")) {
      markRead.mutate(newestId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newestId, entryReady, messagesQuery.blocksRead]);

  // A reference picked in the @ overlay is inserted at the cursor as @label.
  // Focus-guarded: the thread screen stacks on top with its own composer.
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

  const restorePreEditCompose = useCallback(() => {
    const stash = preEditStashRef.current;
    preEditStashRef.current = null;
    setDraft(stash?.draft ?? "");
    mentionsRef.current = stash?.mentions ?? [];
  }, []);

  const resetCompose = useCallback(() => {
    restorePreEditCompose();
    setReplyTo(null);
    setEditing(null);
  }, [restorePreEditCompose]);

  const dispatchSend = useCallback(
    (content: string, replyId: string | undefined, attachmentFileIds: string[]) => {
      flushOnSend();
      resetCompose();
      attachments.clear();
      messagesQuery.jumpToLatest();
      sendMessage.mutate({ content, replyToId: replyId, attachmentFileIds });
      // Only a scrolled-up sender needs snapping back to the newest message
      // (offset 0 in the inverted list). Firing it unconditionally animates the
      // list while it is already pinned there, which fights the insert the
      // anchor is busy absorbing. Deferred a frame so the optimistic row lands
      // first.
      if (messagesQuery.windowed || scrollOffsetRef.current > NEAR_BOTTOM_PX) {
        requestAnimationFrame(() => {
          listRef.current?.scrollToOffset({ offset: 0, animated: true });
        });
      }
    },
    [flushOnSend, resetCompose, attachments, sendMessage, messagesQuery],
  );

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

    // Nothing is cleared before the user confirms, so cancelling leaves the
    // composer exactly as it was.
    const broadcastKinds = broadcastMentionsIn(content);
    const memberCount = channel?.memberCount ?? 0;
    const threshold = chatPolicy?.confirmThreshold ?? DEFAULT_BROADCAST_CONFIRM_THRESHOLD;
    if (broadcastKinds.length > 0 && memberCount > threshold) {
      const kind = effectiveBroadcastKind(broadcastKinds);
      Alert.alert(
        "Notify the whole channel?",
        kind === "here"
          ? `This mentions @here. Members online right now, out of ${memberCount} in the channel, will be notified.`
          : `This mentions @channel. Up to ${memberCount} people will be notified.`,
        [
          { text: "Cancel", style: "cancel" },
          { text: "Send", onPress: () => dispatchSend(content, replyId, attachmentFileIds) },
        ],
      );
      return;
    }

    dispatchSend(content, replyId, attachmentFileIds);
  }, [
    draft,
    editing,
    replyTo,
    attachments,
    editMessage,
    resetCompose,
    dispatchSend,
    channel?.memberCount,
    chatPolicy?.confirmThreshold,
  ]);

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

  const startEdit = useCallback(
    (message: SerializedMessage) => {
      const { display, mentions } = parseMentions(message.content);
      preEditStashRef.current ??= { draft, mentions: mentionsRef.current };
      setEditing(message);
      setReplyTo(null);
      setDraft(display);
      mentionsRef.current = mentions;
      setTimeout(() => inputRef.current?.focus(), 60);
    },
    // `draft` is load-bearing even though it only feeds a ref: without it the
    // callback keeps the empty draft it closed over on mount and stashes that,
    // so cancelling an edit wipes whatever the user had already typed.
    // eslint-disable-next-line react/react-compiler
    [draft],
  );

  const startReply = useCallback(
    (message: SerializedMessage) => {
      if (editing) restorePreEditCompose();
      setReplyTo(message);
      setEditing(null);
      setTimeout(() => inputRef.current?.focus(), 60);
    },
    [editing, restorePreEditCompose],
  );

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

  const listRef = useRef<FlatList<MessageRowItem>>(null);
  const scrollOffsetRef = useRef(0);

  // Every per-row handler is stable and takes the message, so a screen re-render
  // hands MessageRow the same function identities and its memo holds. Inline
  // closures here would defeat it and re-parse every visible message's markdown.
  const openActions = useCallback(
    (message: SerializedMessage) => {
      // Evaluated when the sheet opens so the clock read stays out of render.
      setActionEditAllowed(editWindowAllows(message, chatPolicy));
      setActionMessage(message);
    },
    [chatPolicy],
  );
  const openEditHistory = useCallback(
    (message: SerializedMessage) => setHistoryMessage(message),
    [],
  );
  const elevatedHistoryViewer =
    canManageChat ||
    channelQuery.data?.currentUserRole === "ADMIN" ||
    channelQuery.data?.currentUserRole === "OWNER";
  const openThreadFor = useCallback(
    (message: SerializedMessage) => openThread(message.id),
    [openThread],
  );

  // Scroll a quoted message into view. Silently a no-op when the target sits in
  // a page the transcript has not loaded yet - there is no id-addressable fetch
  // for a single older message, only the page walk that onEndReached drives.
  const jumpToMessage = useCallback(
    (messageId: string | undefined) => {
      if (!messageId) return;
      const index = rows.findIndex(
        (row) => row.message.id === messageId || row.toolRun?.some((m) => m.id === messageId),
      );
      if (index < 0) return;
      listRef.current?.scrollToIndex({ index, viewPosition: 0.5, animated: true });
    },
    [rows],
  );

  const jumpToReplyContext = useCallback(
    (message: SerializedMessage) => jumpToMessage(message.replyContext?.id),
    [jumpToMessage],
  );

  // Entering a busy channel otherwise lands at the newest message with no way
  // back to where the user left off. Fires once per channel entry; the anchor
  // itself is latched, so later polls never re-trigger it.
  useFocusEffect(
    useCallback(() => {
      setEntryVisit((visit) => visit + 1);
    }, []),
  );
  useEffect(() => {
    if (landedOnUnreadRef.current || !firstUnreadId || rows.length === 0) return;
    if (!rows.some((row) => row.message.id === firstUnreadId)) return;
    landedOnUnreadRef.current = true;
    jumpToMessage(firstUnreadId);
  }, [firstUnreadId, rows, jumpToMessage]);

  const renderItem = useCallback(
    ({ item, index }: { item: MessageRowItem; index: number }) => {
      const message = item.message;
      const older = rows[index + 1]?.message;
      const newDay = !older || !isSameDay(message.createdAtSeconds, older.createdAtSeconds);
      const showHeader =
        newDay ||
        older.senderId !== message.senderId ||
        message.createdAtSeconds - older.createdAtSeconds > GROUP_WINDOW_SECONDS;
      // The list is inverted, so a run's last message is the one whose NEWER
      // neighbour breaks the run - or which has no newer neighbour at all.
      const newer = rows[index - 1]?.message;
      const isGroupTail =
        !newer ||
        newer.senderId !== message.senderId ||
        !isSameDay(newer.createdAtSeconds, message.createdAtSeconds) ||
        newer.createdAtSeconds - message.createdAtSeconds > GROUP_WINDOW_SECONDS;
      // System notices have nothing to quote, and a message still in flight has
      // no server id for the reply to point at.
      const canSwipeReply = message.senderType !== "SYSTEM" && message.metadata?.optimistic !== "1";
      const holdsUnreadAnchor =
        message.id === firstUnreadId || !!item.toolRun?.some((m) => m.id === firstUnreadId);
      return (
        <View>
          {newDay ? <DaySeparator label={formatDayLabel(message.createdAtSeconds)} T={T} /> : null}
          {holdsUnreadAnchor ? <UnreadDivider T={T} /> : null}
          <SwipeToReply
            T={T}
            enabled={canSwipeReply}
            hasAvatar={showHeader}
            onReply={() => startReply(message)}
          >
            <MessageRow
              message={message}
              toolRun={item.toolRun}
              T={T}
              organizationId={organizationId ?? ""}
              showHeader={showHeader}
              isGroupTail={isGroupTail}
              hideReplyContext={hideReplyContext}
              isOwn={message.senderId === user?.id}
              layout={chatLayout}
              senderPresence={
                message.senderType === "USER"
                  ? (presenceByUser[message.senderId] ?? "offline")
                  : null
              }
              agentActive={agentRunning}
              thinking={
                message.senderType === "AGENT" ? thinkingByMessage?.[message.id] : undefined
              }
              agentEmoji={
                message.senderType === "AGENT"
                  ? (agentById.get(message.senderId)?.avatarEmoji ?? null)
                  : null
              }
              agentName={
                message.senderType === "AGENT"
                  ? (agentById.get(message.senderId)?.name ?? null)
                  : null
              }
              toolResultFor={toolResultFor}
              resolveUserName={resolveUserName}
              onLongPress={openActions}
              onPressEdited={
                message.senderType === "USER" &&
                (message.senderId === user?.id ||
                  elevatedHistoryViewer ||
                  chatPolicy?.editHistoryVisibleTo === "everyone")
                  ? openEditHistory
                  : undefined
              }
              onPressFailed={promptFailedSend}
              onPressThread={openThreadFor}
              onPressThreadRoot={openThread}
              threadRootContent={
                message.threadReplyContext
                  ? threadRootContentById?.get(message.threadReplyContext.rootMessageId)
                  : undefined
              }
              onPressReplyContext={jumpToReplyContext}
              onToggleReaction={handleReact}
              onShowReactors={setReactorsTarget}
            />
          </SwipeToReply>
        </View>
      );
    },
    [
      rows,
      T,
      user?.id,
      chatLayout,
      organizationId,
      handleReact,
      firstUnreadId,
      promptFailedSend,
      agentRunning,
      thinkingByMessage,
      agentById,
      toolResultFor,
      resolveUserName,
      openActions,
      openEditHistory,
      elevatedHistoryViewer,
      chatPolicy?.editHistoryVisibleTo,
      openThreadFor,
      openThread,
      threadRootContentById,
      presenceByUser,
      hideReplyContext,
      startReply,
      jumpToReplyContext,
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
    <View
      style={[styles.container, { backgroundColor: T.pageBg }]}
      onLayout={(e) => noteTranscriptHeight(e.nativeEvent.layout.height)}
    >
      <View style={styles.headerOverlay}>
        <DomainHeader
          title={title}
          subtitle={subtitle}
          color={T.accent}
          icon="chat"
          translucent
          leading={
            dmPeer ? (
              <Avatar name={dmPeer.name} avatarUrl={dmPeer.avatarUrl} size={30} circle />
            ) : undefined
          }
          rightActions={
            <>
              {(callsAvailable || callsDisabledMessage) && channel && !channel.isAgentDm ? (
                <TouchableOpacity
                  onPress={() => {
                    // The button stays put when calls are off so there is
                    // something to tap that says why.
                    if (callsDisabledMessage) {
                      showCallsUnavailable(callsDisabledMessage);
                      return;
                    }
                    if (inCallHere) setMinimized(false);
                    else openChannelPrejoin();
                  }}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: !callsAvailable }}
                  accessibilityLabel={
                    callsDisabledMessage
                      ? "Calls unavailable"
                      : activeCall
                        ? "Join live call"
                        : "Start call"
                  }
                >
                  {callsDisabledMessage ? (
                    <PhoneSlash size={18} color={T.textDim} weight="bold" />
                  ) : activeCall ? (
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
                accessibilityRole="button"
                accessibilityLabel="Pinned messages"
              >
                <PushPin size={18} color={T.textDim} weight="bold" />
              </TouchableOpacity>
              {channel ? (
                <TouchableOpacity
                  onPress={() => setDetailsOpen(true)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  accessibilityRole="button"
                  accessibilityLabel="Channel details"
                >
                  <ChannelTypeBadge channel={channel} T={T} />
                </TouchableOpacity>
              ) : null}
            </>
          }
        />
      </View>

      {messagesQuery.isLoading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color={T.accent} />
        </View>
      ) : messagesQuery.error ? (
        <View style={styles.emptyWrap}>
          <Text style={[styles.emptySub, { color: T.textDim }]}>Could not load messages</Text>
          <TouchableOpacity onPress={messagesQuery.retry} accessibilityRole="button">
            <Text style={{ color: T.accent }}>Retry</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={messagesQuery.jumpToLatest} accessibilityRole="button">
            <Text style={{ color: T.accent }}>Jump to latest</Text>
          </TouchableOpacity>
        </View>
      ) : messages.length === 0 && !messagesQuery.windowed ? (
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
        <View style={[styles.transcriptSlot, { marginBottom: -(restingFooterHeight + barSpace) }]}>
          <Animated.View
            style={[
              transcriptHeight > 0 ? { height: transcriptHeight } : styles.fill,
              transcriptLift,
            ]}
          >
            <FlatList
              ref={listRef}
              style={styles.list}
              data={rows}
              renderItem={renderItem}
              keyExtractor={(item) => item.message.id}
              // Written from the scroll event, not from render.
              // eslint-disable-next-line react/react-compiler
              onScroll={(e) => (scrollOffsetRef.current = e.nativeEvent.contentOffset.y)}
              scrollEventThrottle={16}
              inverted
              showsVerticalScrollIndicator={false}
              // Anchors the visible rows so nothing above jumps when a row is
              // inserted or changes height - a sent message, a tool pane unfolding,
              // markdown reflowing, an older page landing. autoscrollToTopThreshold
              // is what still carries the reader to a new message while they sit at
              // the newest end (offset 0 here, since the list is inverted).
              maintainVisibleContentPosition={{
                minIndexForVisible: 0,
                autoscrollToTopThreshold: NEAR_BOTTOM_PX,
              }}
              contentContainerStyle={[
                styles.listContent,
                { paddingTop: restingFooterHeight + barSpace + 12, paddingBottom: insets.top + 12 },
              ]}
              keyboardShouldPersistTaps="handled"
              // interactive is iOS-only and degrades to no dismissal at all on
              // Android, where dragging the transcript has to close the keyboard too.
              keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
              // Rows are variable height and there is no getItemLayout, so a jump to
              // an unrendered index has to fall back to an estimate.
              onScrollToIndexFailed={(info) =>
                listRef.current?.scrollToOffset({
                  offset: info.averageItemLength * info.index,
                  animated: true,
                })
              }
              onEndReached={() => void messagesQuery.loadOlder()}
              onEndReachedThreshold={0.4}
              // Messages are markdown, so a mounted row is expensive to build.
              // Holding ten screens of them either way (the default) makes every
              // relayout - the keyboard's most of all - drag a crowd along.
              windowSize={11}
              initialNumToRender={14}
              maxToRenderPerBatch={8}
              ListHeaderComponent={
                messagesQuery.windowed ? (
                  <View style={styles.loadOlderWrap}>
                    {messagesQuery.error ? (
                      <TouchableOpacity onPress={messagesQuery.retry} accessibilityRole="button">
                        <Text style={{ color: T.accent }}>Retry loading messages</Text>
                      </TouchableOpacity>
                    ) : messagesQuery.hasNewer ? (
                      <TouchableOpacity
                        onPress={messagesQuery.loadNewer}
                        disabled={messagesQuery.isLoadingNewer}
                        accessibilityRole="button"
                      >
                        <Text style={{ color: T.accent }}>
                          {messagesQuery.isLoadingNewer ? "Loading messages" : "Newer messages"}
                        </Text>
                      </TouchableOpacity>
                    ) : null}
                    <TouchableOpacity
                      onPress={() => {
                        messagesQuery.jumpToLatest();
                        listRef.current?.scrollToOffset({ offset: 0, animated: false });
                      }}
                      accessibilityRole="button"
                    >
                      <Text style={{ color: T.accent }}>Jump to latest</Text>
                    </TouchableOpacity>
                  </View>
                ) : null
              }
              ListFooterComponent={
                messagesQuery.isLoadingOlder ? (
                  <View style={styles.loadOlderWrap}>
                    <ActivityIndicator size="small" color={T.accent} />
                  </View>
                ) : null
              }
            />
          </Animated.View>
        </View>
      )}

      <View
        style={{ marginBottom: barSpace }}
        onLayout={(e) => noteFooterHeight(e.nativeEvent.layout.height)}
      >
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
            onPress={openChannelPrejoin}
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

        {mentionTypeahead.token ? (
          <MentionSuggestionsBar
            results={mentionTypeahead.results}
            isLoading={mentionTypeahead.isLoading}
            onPick={pickMentionSuggestion}
          />
        ) : null}

        {channel?.isArchived ? (
          <Text style={{ color: T.textDim, padding: 16, textAlign: "center" }}>
            This channel is archived. Restore it to send messages.
          </Text>
        ) : (
          <ChatComposer
            T={T}
            inputRef={inputRef}
            draft={draft}
            onChangeDraft={setDraft}
            onSelectionChange={(e) => {
              selectionRef.current = e.nativeEvent.selection;
              setCursor(e.nativeEvent.selection.start);
            }}
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
            model={
              dmAgentId
                ? {
                    label: dmModelLabel,
                    onPress: () => setModelSheetOpen(true),
                    pickerOpen: modelSheetOpen,
                  }
                : undefined
            }
            attachments={attachments.pending}
            onRemoveAttachment={attachments.remove}
          />
        )}
      </View>

      <MessageActionSheet
        message={actionMessage}
        T={T}
        isOwn={actionMessage?.senderId === user?.id}
        editAllowed={actionEditAllowed}
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
        onMarkUnread={() => {
          const msg = actionMessage;
          setActionMessage(null);
          if (!msg || msg.id.startsWith("optimistic-")) return;
          if (markUnread.isPending) return;
          const wasManuallyUnread = manualUnreadRef.current;
          manualUnreadRef.current = true;
          markUnread.mutate(msg.id, {
            onError: () => {
              manualUnreadRef.current = wasManuallyUnread;
            },
          });
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

      <EditHistorySheet message={historyMessage} T={T} onClose={() => setHistoryMessage(null)} />

      <ReactorsSheet
        reaction={reactorsTarget}
        currentUserId={user?.id}
        T={T}
        resolveUserName={resolveUserName}
        onClose={() => setReactorsTarget(null)}
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
          memorySubject={hasAgentMemory ? memorySubject : undefined}
          isMemoryModerator={isMemoryModerator}
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

      {dmAgentId ? (
        <AgentModelSheet
          visible={modelSheetOpen}
          T={T}
          channelId={channelId}
          agent={dmAgent}
          onClose={() => setModelSheetOpen(false)}
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
          canMutate={canModerateChannel}
          onClose={() => setContextAgentId(null)}
        />
      ) : null}
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
    <BottomSheet visible={visible} onClose={onClose}>
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
                    <Text style={[styles.pinnedSender, { color: T.textBright }]} numberOfLines={1}>
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
    </BottomSheet>
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

/**
 * Memoized because the screen re-renders on every poll, stream event and layout
 * change, and an unmemoized row re-parses its markdown each time - with a
 * screenful mounted that is what turned opening the keyboard into a stutter.
 * Every callback prop is stable and takes the message, so the memo actually
 * holds.
 */
/**
 * Wraps its children in a bubble, or passes them through untouched. Renders no
 * view at all when off, so the single-column layout keeps the node count it had
 * before bubbles existed - a transcript mounts a screenful of these.
 */
function Bubble({
  on,
  style,
  children,
}: {
  on: boolean;
  style: StyleProp<ViewStyle>;
  children: React.ReactNode;
}) {
  if (!on) return <>{children}</>;
  return <View style={style}>{children}</View>;
}

const MessageRow = React.memo(function MessageRow({
  message,
  toolRun,
  T,
  organizationId,
  showHeader,
  isGroupTail,
  hideReplyContext,
  isOwn,
  layout,
  agentActive,
  thinking,
  agentEmoji,
  agentName,
  toolResultFor,
  resolveUserName,
  onLongPress,
  onPressEdited,
  onPressFailed,
  onPressThread,
  onPressThreadRoot,
  threadRootContent,
  onPressReplyContext,
  onToggleReaction,
  onShowReactors,
  senderPresence,
}: {
  message: SerializedMessage;
  toolRun?: SerializedMessage[];
  T: ThemeColors;
  organizationId: string;
  showHeader: boolean;
  /** Last message of a same-sender run, so the one that carries the timestamp. */
  isGroupTail: boolean;
  hideReplyContext: boolean;
  isOwn: boolean;
  layout: ChatLayout;
  agentActive: boolean;
  thinking?: AgentThinkingBlock[];
  agentEmoji?: string | null;
  agentName?: string | null;
  toolResultFor: (toolCallId: string) => SerializedMessage | undefined;
  resolveUserName?: (userId: string) => string | undefined;
  onLongPress: (message: SerializedMessage) => void;
  /** Present only when this viewer may read the message's edit history. */
  onPressEdited?: (message: SerializedMessage) => void;
  onPressFailed: (message: SerializedMessage) => void;
  onPressThread: (message: SerializedMessage) => void;
  onPressThreadRoot: (rootMessageId: string) => void;
  /** Content of the thread root this message's caption quotes, when it is loaded. */
  threadRootContent?: string;
  onPressReplyContext: (message: SerializedMessage) => void;
  onToggleReaction: (message: SerializedMessage, emoji: string) => void;
  onShowReactors: (reaction: SerializedReaction) => void;
  senderPresence?: string | null;
}) {
  const { display } = useMemo(() => parseMentions(message.content), [message.content]);
  // The quoted preview is a raw slice of the original's canonical markdown, so
  // it still carries mention syntax; an attachment-only original slices to "".
  const replyPreview = useMemo(() => {
    const preview = message.replyContext?.contentPreview;
    if (!preview) return "Attachment";
    const display = parseMentions(preview).display;
    // Measured on the raw slice: collapsing a mention shortens the display, so
    // the display length would under-report a preview that really was cut.
    return preview.length >= REPLY_PREVIEW_MAX_CHARS ? `${display}...` : display;
  }, [message.replyContext?.contentPreview]);
  const [replyExpanded, setReplyExpanded] = useState(false);
  const threadRootPreview = useMemo(() => {
    if (!threadRootContent) return undefined;
    return parseMentions(threadRootContent)
      .display.replace(/\s+/g, " ")
      .trim()
      .slice(0, THREAD_ROOT_PREVIEW_MAX_CHARS);
  }, [threadRootContent]);
  const isAgent = message.senderType === "AGENT";

  const toggleReplyExpanded = useCallback(() => setReplyExpanded((open) => !open), []);
  const senderName = (isAgent && agentName) || message.senderName;
  const isSystem = message.senderType === "SYSTEM";
  const failed = message.metadata?.failed === "1";
  const pending = message.metadata?.optimistic === "1" && !failed;
  const agentSpecial = isAgent && isSpecialAgentKind(message);
  const jumbo = useMemo(() => !agentSpecial && isEmojiOnly(display), [agentSpecial, display]);

  // Agents take a side too - a reply is a message like any other, and a
  // transcript that bubbles one sender but not the other reads as broken.
  // System notices are the exception: they come from nobody and have no side.
  const sided = layout === "bubbles" && message.senderType !== "SYSTEM";
  // A lone emoji is already its own shape; wrapping it mostly draws a box
  // around empty space.
  const bubbled = sided && !jumbo;
  const ownSide = sided && isOwn;

  // A shrink-wrapped box is as wide as its text would be on one line, clamped
  // to the cap - so a wrapped message keeps the cap's width and wears the whole
  // ragged right edge of the wrap as dead space. The renderer reports what the
  // text actually occupies and the bubble takes that instead. Only prose can be
  // measured, so anything sharing the bubble with it keeps the bubble at its
  // natural width rather than risk squeezing that content.
  const [textWidth, setTextWidth] = useState(0);
  const canHug =
    bubbled &&
    // An agent bubble also holds a thinking pane, a tool timeline or a feedback
    // row, and only the prose can be measured - shrinking to it would squeeze
    // everything else.
    !isAgent &&
    message.attachments.length === 0 &&
    !(!hideReplyContext && message.replyContext) &&
    !message.threadReplyContext &&
    !message.editedAtSeconds &&
    !failed;
  const noteTextWidth = useCallback((width: number) => {
    setTextWidth((prev) => (Math.abs(prev - width) < 1 ? prev : width));
  }, []);

  // The runtime persists reasoning onto the row, so a reply keeps its pane after
  // a reload; the stream cache only holds replies watched as they arrived, and
  // wins while their blocks are still landing.
  const persisted = useMemo(
    () => persistedThinkingBlocks(message.metadata?.thinking),
    [message.metadata?.thinking],
  );
  const thinkingBlocks: readonly ThinkingBlockView[] =
    thinking && thinking.length > 0 ? thinking : persisted;

  if (isSystem) {
    return <SystemMessage content={message.content} metadata={message.metadata} />;
  }

  return (
    <Pressable
      onLongPress={pending || failed ? undefined : () => onLongPress(message)}
      // A row covers the full width, and keyboardShouldPersistTaps="handled"
      // treats a tap it catches as handled - so without this the keyboard only
      // closes on the gaps between messages, and a wall of agent replies leaves
      // no gap to hit.
      onPress={failed ? () => onPressFailed(message) : () => Keyboard.dismiss()}
      delayLongPress={250}
      style={[
        styles.msgRow,
        !showHeader && styles.msgRowGrouped,
        sided && !showHeader && styles.msgRowSidedGrouped,
        ownSide && styles.msgRowOwn,
      ]}
    >
      {/* The reader's own side needs no avatar: every message there is theirs,
          so the column would only push the bubbles off the edge. */}
      {ownSide ? null : (
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
      )}
      <View
        style={[
          styles.msgBody,
          sided && styles.msgBodySided,
          // Both sides must pin their children to an edge. Left to stretch, the
          // bubble grows to the width of the widest thing under it - which is
          // the timestamp - so a one-word message wears a bubble sized for the
          // clock instead of for the word.
          sided && (ownSide ? styles.itemsEnd : styles.itemsStart),
        ]}
      >
        <Bubble
          on={bubbled}
          style={[
            styles.bubble,
            { backgroundColor: isOwn ? T.accentSoft : T.surface },
            canHug && textWidth > 0 && { width: Math.ceil(textWidth) + BUBBLE_PAD_X * 2 },
          ]}
        >
          {/* Sided messages name nobody: the avatar beside the bubble already
              identifies the sender, and the reader's own side needs no label at
              all, so a name line would just push the text down a row. Agents
              keep theirs - the AGENT badge rides on it, and which side a message
              sits on is not enough to tell a person from a machine. */}
          {showHeader && (!sided || isAgent) ? (
            <View style={styles.msgHeader}>
              <Text style={[styles.msgSender, { color: T.textBright }]} numberOfLines={1}>
                {senderName}
              </Text>
              {isAgent ? (
                <View style={[styles.agentTag, { backgroundColor: T.accentSoft }]}>
                  <Text style={[styles.agentTagText, { color: T.accent }]}>AGENT</Text>
                </View>
              ) : null}
              {/* A sided message is stamped under its bubble, so the header
                  carries the name and the badge only. */}
              {sided ? null : (
                <Text style={[styles.msgTime, { color: T.textDim }]}>{message.timeLabel}</Text>
              )}
              {message.isPinned && !sided ? (
                <PushPin size={11} color={T.accent} weight="fill" />
              ) : null}
            </View>
          ) : null}
          {!hideReplyContext && message.replyContext ? (
            <View
              style={[
                styles.replyContext,
                replyExpanded && styles.replyContextOpen,
                { backgroundColor: T.surfaceHover },
              ]}
            >
              <View style={styles.replyContextHead}>
                <TouchableOpacity
                  style={styles.replyContextJump}
                  onPress={() => onPressReplyContext(message)}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel={`Go to the message from ${message.replyContext.senderName}`}
                >
                  <Avatar name={message.replyContext.senderName} size={18} circle />
                  <Text
                    style={[styles.replyContextName, { color: T.textBright }]}
                    numberOfLines={1}
                  >
                    {message.replyContext.senderName}
                  </Text>
                  {replyExpanded ? null : (
                    <Text style={[styles.replyContextText, { color: T.textDim }]} numberOfLines={1}>
                      {replyPreview}
                    </Text>
                  )}
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={toggleReplyExpanded}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  accessibilityRole="button"
                  accessibilityLabel={replyExpanded ? "Collapse quoted message" : "Read it here"}
                >
                  {replyExpanded ? (
                    <CaretUp size={12} color={T.textDim} weight="bold" />
                  ) : (
                    <CaretDown size={12} color={T.textDim} weight="bold" />
                  )}
                </TouchableOpacity>
              </View>
              {replyExpanded ? (
                <Text style={[styles.replyContextBody, { color: T.textDim }]}>{replyPreview}</Text>
              ) : null}
            </View>
          ) : null}
          {isAgent && !agentSpecial && thinkingBlocks.length > 0 ? (
            <ThinkingPane
              blocks={thinkingBlocks}
              live={agentActive && thinkingBlocks.some((b) => !b.done)}
              answerStarted={message.content.length > 0 || !agentActive}
              T={T}
            />
          ) : null}
          {agentSpecial ? (
            <AgentMessageBody
              message={message}
              toolRun={toolRun}
              T={T}
              agentActive={agentActive}
              toolResultFor={toolResultFor}
              resolveUserName={resolveUserName}
            />
          ) : jumbo ? (
            <Text style={styles.jumboEmoji}>{display.trim()}</Text>
          ) : display.length > 0 ? (
            <MarkdownRenderer
              content={message.content}
              onMeasureWidth={canHug ? noteTextWidth : undefined}
            />
          ) : null}
          {message.attachments.length > 0 ? (
            <MessageAttachments
              attachments={message.attachments}
              organizationId={organizationId}
              T={T}
            />
          ) : null}
          {message.threadReplyContext ? (
            <ThreadReplyCaption
              context={message.threadReplyContext}
              rootPreview={threadRootPreview}
              T={T}
              onPress={onPressThreadRoot}
            />
          ) : null}
          {message.editedAtSeconds ? (
            <Text
              style={[styles.editedTag, { color: T.textDim }]}
              onPress={onPressEdited ? () => onPressEdited(message) : undefined}
              suppressHighlighting
            >
              (edited)
            </Text>
          ) : null}
          {failed ? (
            <View style={styles.failedRow}>
              <WarningCircle size={13} color={T.red} weight="fill" />
              <Text style={[styles.failedText, { color: T.red }]}>Not sent - tap for options</Text>
            </View>
          ) : null}
        </Bubble>
        {/* Outside the bubble, and only on a run's last message: stamping each
            one puts a line longer than "Hi" under every "Hi", which widens the
            bubble to fit the clock rather than the message. */}
        {sided && isGroupTail ? (
          <View style={styles.msgFooter}>
            {/* The pin rides here because the header that normally carries it is
                not rendered on a sided message. */}
            {message.isPinned ? <PushPin size={10} color={T.accent} weight="fill" /> : null}
            <Text style={[styles.msgTime, { color: T.textDim }]}>{message.timeLabel}</Text>
          </View>
        ) : null}
        {message.replyCount > 0 ? (
          <TouchableOpacity
            style={[
              styles.threadChip,
              { backgroundColor: T.accentSoft },
              ownSide && styles.alignEnd,
            ]}
            onPress={() => onPressThread(message)}
            activeOpacity={0.7}
          >
            <ChatText size={12} color={T.accent} weight="duotone" />
            <Text style={[styles.threadChipText, { color: T.accent }]}>
              {message.replyCount} {message.replyCount === 1 ? "reply" : "replies"}
            </Text>
          </TouchableOpacity>
        ) : null}
        {message.reactions.length > 0 ? (
          <View style={[styles.reactionsRow, ownSide && styles.reactionsRowOwn]}>
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
                onPress={() => onToggleReaction(message, r.emoji)}
                onLongPress={() => onShowReactors(r)}
                delayLongPress={250}
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
});

function MessageActionSheet({
  message,
  T,
  isOwn,
  editAllowed,
  onClose,
  onReact,
  onMoreEmojis,
  onReply,
  onThread,
  onPin,
  onEdit,
  onCopy,
  onMarkUnread,
  onDelete,
}: {
  message: SerializedMessage | null;
  T: ThemeColors;
  isOwn: boolean;
  /** Edit-window policy decision, evaluated when the sheet opened. */
  editAllowed: boolean;
  onClose: () => void;
  onReact: (emoji: string) => void;
  onMoreEmojis: () => void;
  onReply: () => void;
  onThread: () => void;
  onPin: () => void;
  onEdit: () => void;
  onCopy: () => void;
  onMarkUnread: () => void;
  onDelete: () => void;
}) {
  const canEdit = isOwn && message?.senderType === "USER" && editAllowed;
  return (
    <BottomSheet visible={!!message} onClose={onClose}>
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
      <SheetAction
        T={T}
        onPress={onMarkUnread}
        icon={<EnvelopeSimple size={18} color={T.text} weight="duotone" />}
        label="Mark as unread"
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
    </BottomSheet>
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
  headerOverlay: { position: "absolute", top: 0, left: 0, right: 0, zIndex: 10 },
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
  fill: { flex: 1 },
  // Clips the transcript that rides up under the header while lifted. The
  // negative margin lives here now, so the bottom edge it clips sits behind the
  // composer glass where nothing is visible anyway.
  transcriptSlot: { flex: 1, overflow: "hidden" },
  listContent: { paddingVertical: 12 },
  loadOlderWrap: { paddingVertical: 14, alignItems: "center" },
  msgRow: { flexDirection: "row", gap: 10, paddingHorizontal: 16, paddingTop: 10 },
  msgRowGrouped: { paddingTop: 1 },
  // Bubbles need air between them that a shared column does not: at 1px the
  // rounded edges of two consecutive ones read as a single lumpy shape.
  msgRowSidedGrouped: { paddingTop: 3 },
  msgRowOwn: { justifyContent: "flex-end" },
  msgAvatar: { width: 36 },
  msgBody: { flex: 1, gap: 1 },
  // Overrides msgBody's flex:1 so the bubble hugs its text instead of filling
  // the row, while still wrapping before it reaches the far margin.
  msgBodySided: { flex: 0, flexShrink: 1, maxWidth: "78%" },
  bubble: { borderRadius: 16, paddingHorizontal: BUBBLE_PAD_X, paddingVertical: 7, gap: 1 },
  // The row is a flex row, so its own alignSelf would only move the body up or
  // down; pushing the stamp and the chips to the reader's side is the cross-axis
  // job of the body itself.
  itemsEnd: { alignItems: "flex-end" },
  itemsStart: { alignItems: "flex-start" },
  alignEnd: { alignSelf: "flex-end" },
  msgFooter: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 },
  msgHeader: { flexDirection: "row", alignItems: "center", gap: 7 },
  msgSender: { fontSize: 14, lineHeight: 16, fontFamily: FONT.semibold, flexShrink: 1 },
  agentTag: { paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4 },
  agentTagText: { fontSize: 9, fontFamily: FONT.bold, letterSpacing: 0.4 },
  msgTime: { fontSize: 11, fontFamily: FONT.regular },
  editedTag: { fontSize: 11, fontFamily: FONT.regular },
  jumboEmoji: { fontSize: 40, lineHeight: 48, paddingVertical: 2 },
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
    alignSelf: "flex-start",
    maxWidth: "100%",
    borderRadius: 13,
    paddingLeft: 4,
    paddingRight: 10,
    paddingVertical: 4,
    marginBottom: 4,
  },
  // Squarer and roomier once it holds a wrapped paragraph - a tall pill reads
  // as a mistake.
  replyContextOpen: { borderRadius: 12, paddingRight: 12, paddingBottom: 8 },
  replyContextHead: { flexDirection: "row", alignItems: "center", gap: 7 },
  replyContextJump: { flexDirection: "row", alignItems: "center", gap: 7, flexShrink: 1 },
  replyContextName: { fontSize: 12, lineHeight: 16, fontFamily: FONT.semibold, flexShrink: 0 },
  replyContextText: { fontSize: 12, lineHeight: 16, fontFamily: FONT.regular, flexShrink: 1 },
  replyContextBody: {
    fontSize: 12,
    lineHeight: 17,
    fontFamily: FONT.regular,
    marginTop: REPLY_BODY_GAP,
    marginLeft: 4,
  },
  reactionsRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 4 },
  reactionsRowOwn: { justifyContent: "flex-end" },
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
