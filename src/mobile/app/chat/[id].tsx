import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Modal,
  Alert,
  Pressable,
  ScrollView,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import {
  PaperPlaneRight,
  At,
  Trash,
  Copy,
  Hash,
  Lock,
  Robot,
  ChatCircle,
  Stop,
  Smiley,
  Code,
  TextB,
  PushPin,
  PushPinSlash,
  PencilSimple,
  ArrowBendUpLeft,
  Check,
  X,
} from "phosphor-react-native";
import { useLocalSearchParams } from "expo-router";
import { DomainHeader } from "@/components/DomainHeader";
import { Avatar } from "@/components/Avatar";
import { useTheme } from "@/hooks/useTheme";
import type { ThemeColors } from "@/constants/theme";
import { DOMAIN_COLORS } from "@/constants/theme";
import { useAuth } from "@/context/auth-context";
import { useUniffy } from "@/context/uniffy-context";
import { useChannel, useMessages, useChannelMembers } from "@/hooks/useChat";
import {
  useSendMessage,
  useDeleteMessage,
  useToggleReaction,
  useMarkChannelRead,
  useEditMessage,
  usePinMessage,
} from "@/hooks/useChatMutations";
import { useStopAgentRun } from "@/hooks/useAgents";
import { parseMentions, toCanonical, type MentionEntry } from "@/hooks/useMentionInput";
import { resolveChannelTitle, type SerializedMessage } from "@/lib/chatSerializer";

const GROUP_WINDOW_SECONDS = 300;
const QUICK_EMOJIS = ["👍", "❤️", "😂", "🎉", "👀", "🙏"];
const EMOJI_PALETTE = [
  "👍", "👎", "❤️", "🔥", "🎉", "😂", "😍", "🤔", "👀", "🙏",
  "✅", "❌", "💯", "🚀", "👏", "🙌", "😎", "😅", "😢", "😡",
  "🥳", "🤩", "😴", "🤝", "💪", "✨", "⭐", "💡", "📌", "⚡",
  "🎯", "🐛", "🔧", "📝", "💬", "👋", "🤞", "🫡", "😬", "🤯",
];

type SelectionRange = { start: number; end: number };

export default function ChatConversationScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const channelId = id ?? "";
  const T = useTheme();
  const { user } = useAuth();
  const { pendingReference, clearPendingReference, openAt } = useUniffy();

  const channelQuery = useChannel(channelId);
  const messagesQuery = useMessages(channelId);
  const membersQuery = useChannelMembers(channelId);
  const sendMessage = useSendMessage(channelId);
  const deleteMessage = useDeleteMessage(channelId);
  const toggleReaction = useToggleReaction(channelId);
  const editMessage = useEditMessage(channelId);
  const pinMessage = usePinMessage(channelId);
  const markRead = useMarkChannelRead(channelId);
  const stopAgent = useStopAgentRun();

  const [draft, setDraft] = useState("");
  const mentionsRef = useRef<MentionEntry[]>([]);
  const selectionRef = useRef<SelectionRange>({ start: 0, end: 0 });
  const inputRef = useRef<TextInput>(null);
  const [actionMessage, setActionMessage] = useState<SerializedMessage | null>(null);
  const [replyTo, setReplyTo] = useState<SerializedMessage | null>(null);
  const [editing, setEditing] = useState<SerializedMessage | null>(null);
  const [emojiTarget, setEmojiTarget] = useState<SerializedMessage | "compose" | null>(null);

  const messages = useMemo(() => messagesQuery.data ?? [], [messagesQuery.data]);
  const channel = channelQuery.data;

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
  useEffect(() => {
    if (!pendingReference) return;
    const contentType =
      { notes: "NOTE", files: "FILE", chat: "CHAT", calendar: "CALENDAR_EVENT", projects: "PROJECT" }[
        pendingReference.domain
      ] ?? "NOTE";
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
    if (!text) return;
    if (editing) {
      const content = toCanonical(draft, mentionsRef.current);
      editMessage.mutate({ messageId: editing.id, content });
      resetCompose();
      return;
    }
    const content = toCanonical(draft, mentionsRef.current);
    const replyId = replyTo?.id;
    resetCompose();
    sendMessage.mutate({ content, replyToId: replyId });
  }, [draft, editing, replyTo, sendMessage, editMessage, resetCompose]);

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

  const renderItem = useCallback(
    ({ item, index }: { item: SerializedMessage; index: number }) => {
      const older = messages[index + 1];
      const showHeader =
        !older ||
        older.senderId !== item.senderId ||
        item.createdAtSeconds - older.createdAtSeconds > GROUP_WINDOW_SECONDS;
      return (
        <MessageRow
          message={item}
          T={T}
          showHeader={showHeader}
          isOwn={item.senderId === user?.id}
          onLongPress={() => setActionMessage(item)}
          onToggleReaction={(emoji) => handleReact(item, emoji)}
        />
      );
    },
    [messages, T, user?.id, handleReact],
  );

  if (channelQuery.isLoading) {
    return (
      <View style={[styles.container, { backgroundColor: T.pageBg }]}>
        <DomainHeader title="Chat" color={DOMAIN_COLORS.chat} icon="chat" />
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color={DOMAIN_COLORS.chat} />
        </View>
      </View>
    );
  }

  const canSend = !!draft.trim();

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: T.pageBg }]}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <DomainHeader
        title={title}
        subtitle={subtitle}
        color={DOMAIN_COLORS.chat}
        icon="chat"
        rightActions={channel ? <ChannelTypeBadge channel={channel} T={T} /> : null}
      />

      {messagesQuery.isLoading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color={DOMAIN_COLORS.chat} />
        </View>
      ) : messages.length === 0 ? (
        <View style={styles.emptyWrap}>
          <ChatCircle size={40} color={DOMAIN_COLORS.chat} weight="duotone" />
          <Text style={[styles.emptyTitle, { color: T.textBright }]}>No messages yet</Text>
          <Text style={[styles.emptySub, { color: T.textDim }]}>
            Say hello to start the conversation
          </Text>
        </View>
      ) : (
        <FlatList
          data={messages}
          renderItem={renderItem}
          keyExtractor={(item) => item.id}
          inverted
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.listContent}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
        />
      )}

      {channel?.isAgentDm && channel.agentId && messages[0]?.senderType === "USER" ? (
        <TouchableOpacity
          style={[styles.stopPill, { backgroundColor: T.surface, borderColor: T.border }]}
          onPress={() => stopAgent.mutate({ channelId, agentId: channel.agentId! })}
          activeOpacity={0.7}
        >
          <Stop size={14} color={T.red} weight="fill" />
          <Text style={[styles.stopText, { color: T.text }]}>Stop agent</Text>
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

      <View style={[styles.composer, { backgroundColor: T.surface, borderTopColor: T.border }]}>
        <View style={styles.toolbar}>
          <ToolbarButton onPress={() => setEmojiTarget("compose")}>
            <Smiley size={20} color={T.textDim} weight="regular" />
          </ToolbarButton>
          <ToolbarButton onPress={() => openAt(true)}>
            <At size={20} color={T.textDim} weight="bold" />
          </ToolbarButton>
          <ToolbarButton onPress={() => wrapSelection("**")}>
            <TextB size={19} color={T.textDim} weight="bold" />
          </ToolbarButton>
          <ToolbarButton onPress={() => wrapSelection("`")}>
            <Code size={19} color={T.textDim} weight="bold" />
          </ToolbarButton>
        </View>
        <View style={styles.inputRow}>
          <TextInput
            ref={inputRef}
            value={draft}
            onChangeText={setDraft}
            onSelectionChange={(e) => (selectionRef.current = e.nativeEvent.selection)}
            placeholder={editing ? "Edit message" : `Message ${title}`}
            placeholderTextColor={T.textDim}
            style={[
              styles.input,
              { color: T.textBright, backgroundColor: T.bg, borderColor: T.border },
            ]}
            multiline
          />
          <TouchableOpacity
            style={[styles.sendBtn, { backgroundColor: canSend ? DOMAIN_COLORS.chat : T.surfaceHover }]}
            onPress={handleSend}
            disabled={!canSend}
            activeOpacity={0.8}
          >
            {editing ? (
              <Check size={18} color={canSend ? "#fff" : T.textDim} weight="bold" />
            ) : (
              <PaperPlaneRight size={18} color={canSend ? "#fff" : T.textDim} weight="fill" />
            )}
          </TouchableOpacity>
        </View>
      </View>

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
    </KeyboardAvoidingView>
  );
}

function ToolbarButton({ onPress, children }: { onPress: () => void; children: React.ReactNode }) {
  return (
    <TouchableOpacity
      style={styles.toolbarBtn}
      onPress={onPress}
      hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
      activeOpacity={0.6}
    >
      {children}
    </TouchableOpacity>
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
      <View style={[styles.bannerAccent, { backgroundColor: DOMAIN_COLORS.chat }]} />
      <View style={{ flex: 1 }}>
        <Text style={[styles.bannerLabel, { color: DOMAIN_COLORS.chat }]}>
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

function MessageRow({
  message,
  T,
  showHeader,
  isOwn,
  onLongPress,
  onToggleReaction,
}: {
  message: SerializedMessage;
  T: ThemeColors;
  showHeader: boolean;
  isOwn: boolean;
  onLongPress: () => void;
  onToggleReaction: (emoji: string) => void;
}) {
  const { display } = useMemo(() => parseMentions(message.content), [message.content]);
  const isAgent = message.senderType === "AGENT";
  const isSystem = message.senderType === "SYSTEM";
  const pending = message.metadata?.optimistic === "1";

  if (isSystem) {
    return (
      <View style={styles.systemRow}>
        <Text style={[styles.systemText, { color: T.textDim }]}>{display}</Text>
      </View>
    );
  }

  return (
    <Pressable
      onLongPress={pending ? undefined : onLongPress}
      delayLongPress={250}
      style={[styles.msgRow, !showHeader && styles.msgRowGrouped]}
    >
      <View style={styles.msgAvatar}>
        {showHeader ? (
          <Avatar
            name={message.senderName}
            avatarUrl={message.senderAvatarUrl ?? undefined}
            size={36}
            accentColor={isAgent ? DOMAIN_COLORS.chat : undefined}
          />
        ) : null}
      </View>
      <View style={styles.msgBody}>
        {showHeader ? (
          <View style={styles.msgHeader}>
            <Text style={[styles.msgSender, { color: T.textBright }]} numberOfLines={1}>
              {message.senderName}
            </Text>
            {isAgent ? (
              <View style={[styles.agentTag, { backgroundColor: DOMAIN_COLORS.chatSoft }]}>
                <Text style={[styles.agentTagText, { color: DOMAIN_COLORS.chat }]}>AGENT</Text>
              </View>
            ) : null}
            <Text style={[styles.msgTime, { color: T.textDim }]}>{message.timeLabel}</Text>
            {message.isPinned ? (
              <PushPin size={11} color={DOMAIN_COLORS.chat} weight="fill" />
            ) : null}
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
        <Text style={[styles.msgContent, { color: pending ? T.textDim : T.text }]}>
          {display}
          {message.editedAtSeconds ? (
            <Text style={[styles.editedTag, { color: T.textDim }]}> (edited)</Text>
          ) : null}
        </Text>
        {message.reactions.length > 0 ? (
          <View style={styles.reactionsRow}>
            {message.reactions.map((r) => (
              <TouchableOpacity
                key={r.emoji}
                style={[
                  styles.reactionChip,
                  {
                    backgroundColor: r.currentUserReacted ? DOMAIN_COLORS.chatSoft : T.surface,
                    borderColor: r.currentUserReacted ? DOMAIN_COLORS.chat : T.border,
                  },
                ]}
                onPress={() => onToggleReaction(r.emoji)}
                activeOpacity={0.7}
              >
                <Text style={styles.reactionEmoji}>{r.emoji}</Text>
                <Text
                  style={[
                    styles.reactionCount,
                    { color: r.currentUserReacted ? DOMAIN_COLORS.chat : T.textDim },
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
        <SheetAction T={T} onPress={onReply} icon={<ArrowBendUpLeft size={18} color={T.text} weight="duotone" />} label="Reply" />
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
          <SheetAction T={T} onPress={onEdit} icon={<PencilSimple size={18} color={T.text} weight="duotone" />} label="Edit message" />
        ) : null}
        <SheetAction T={T} onPress={onCopy} icon={<Copy size={18} color={T.text} weight="duotone" />} label="Copy text" />
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

function EmojiPickerSheet({
  visible,
  T,
  onClose,
  onPick,
}: {
  visible: boolean;
  T: ThemeColors;
  onClose: () => void;
  onPick: (emoji: string) => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />
      <View style={[styles.sheet, { backgroundColor: T.surface }]}>
        <View style={[styles.handle, { backgroundColor: T.border }]} />
        <ScrollView contentContainerStyle={styles.emojiGrid}>
          {EMOJI_PALETTE.map((emoji) => (
            <TouchableOpacity
              key={emoji}
              style={[styles.emojiGridBtn, { backgroundColor: T.bg }]}
              onPress={() => onPick(emoji)}
              activeOpacity={0.7}
            >
              <Text style={styles.emojiGridText}>{emoji}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  loadingWrap: { flex: 1, alignItems: "center", justifyContent: "center" },
  emptyWrap: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8, paddingHorizontal: 40 },
  emptyTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold", marginTop: 4 },
  emptySub: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center" },
  listContent: { paddingVertical: 12 },
  msgRow: { flexDirection: "row", gap: 10, paddingHorizontal: 16, paddingTop: 10 },
  msgRowGrouped: { paddingTop: 1 },
  msgAvatar: { width: 36 },
  msgBody: { flex: 1, gap: 3 },
  msgHeader: { flexDirection: "row", alignItems: "center", gap: 7 },
  msgSender: { fontSize: 14, fontFamily: "Inter_600SemiBold", flexShrink: 1 },
  agentTag: { paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4 },
  agentTagText: { fontSize: 9, fontFamily: "Inter_700Bold", letterSpacing: 0.4 },
  msgTime: { fontSize: 11, fontFamily: "Inter_400Regular" },
  msgContent: { fontSize: 15, fontFamily: "Inter_400Regular", lineHeight: 21 },
  editedTag: { fontSize: 11, fontFamily: "Inter_400Regular" },
  replyContext: {
    borderLeftWidth: 2,
    paddingLeft: 8,
    paddingVertical: 1,
    marginBottom: 2,
  },
  replyContextName: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  replyContextText: { fontSize: 12, fontFamily: "Inter_400Regular" },
  systemRow: { paddingHorizontal: 16, paddingVertical: 6, alignItems: "center" },
  systemText: { fontSize: 12, fontFamily: "Inter_400Regular", fontStyle: "italic" },
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
  reactionCount: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  composer: {
    paddingHorizontal: 12,
    paddingTop: 6,
    paddingBottom: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  toolbar: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 2, paddingBottom: 6 },
  toolbarBtn: { padding: 6, borderRadius: 8 },
  inputRow: { flexDirection: "row", alignItems: "flex-end", gap: 8 },
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
  stopText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  bannerAccent: { width: 3, alignSelf: "stretch", borderRadius: 2 },
  bannerLabel: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  bannerText: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 1 },
  input: {
    flex: 1,
    maxHeight: 120,
    minHeight: 40,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 10,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)" },
  sheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingBottom: 32 },
  handle: { width: 36, height: 4, borderRadius: 2, alignSelf: "center", marginTop: 8, marginBottom: 8 },
  emojiRow: { flexDirection: "row", justifyContent: "space-around", paddingHorizontal: 12, paddingVertical: 10 },
  emojiBtn: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  emojiText: { fontSize: 22 },
  emojiGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    justifyContent: "space-between",
  },
  emojiGridBtn: { width: 46, height: 46, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  emojiGridText: { fontSize: 24 },
  sheetAction: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: 15,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  sheetActionText: { fontSize: 15, fontFamily: "Inter_500Medium" },
});
