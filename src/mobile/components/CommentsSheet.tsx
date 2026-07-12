import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Modal,
  FlatList,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from "react-native";
import {
  ChatText,
  PaperPlaneRight,
  X,
  CheckCircle,
  ArrowBendUpLeft,
  Smiley,
} from "phosphor-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Avatar } from "@/components/Avatar";
import { MentionLine } from "@/components/MarkdownRenderer";
import { useTheme } from "@/hooks/useTheme";
import type { ThemeColors } from "@/constants/theme";
import { FONT } from "@/constants/typography";
import { useAuth } from "@/context/auth-context";
import { useComments, useCommentCount, useCommentMutations } from "@/hooks/useComments";
import { parseMentions } from "@/hooks/useMentionInput";
import type { SerializedComment } from "@/lib/commentSerializer";
import type { ContentType } from "@uniffy/proto/common/v1/common_pb";

const QUICK_EMOJIS = ["👍", "❤️", "😂", "🎉", "👀", "🙏"];

/** Header button + count badge that opens the comments sheet for any content. */
export function CommentButton({
  contentType,
  contentId,
  color,
}: {
  contentType: ContentType;
  contentId: string;
  color: string;
}) {
  const T = useTheme();
  const [open, setOpen] = useState(false);
  const countQuery = useCommentCount(contentType, contentId);
  const count = countQuery.data ?? 0;

  return (
    <>
      <TouchableOpacity
        onPress={() => setOpen(true)}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        style={styles.headerBtn}
      >
        <ChatText size={20} color={T.text} weight="regular" />
        {count > 0 ? (
          <View style={[styles.headerBadge, { backgroundColor: color }]}>
            <Text style={styles.headerBadgeText}>{count > 9 ? "9+" : count}</Text>
          </View>
        ) : null}
      </TouchableOpacity>
      <CommentsSheet
        visible={open}
        onClose={() => setOpen(false)}
        contentType={contentType}
        contentId={contentId}
        color={color}
      />
    </>
  );
}

function CommentsSheet({
  visible,
  onClose,
  contentType,
  contentId,
  color,
}: {
  visible: boolean;
  onClose: () => void;
  contentType: ContentType;
  contentId: string;
  color: string;
}) {
  const T = useTheme();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const thread = useComments(contentType, contentId);
  const { create, update, remove, setResolved, toggleReaction } = useCommentMutations(
    contentType,
    contentId,
  );

  const [draft, setDraft] = useState("");
  const [replyTo, setReplyTo] = useState<SerializedComment | null>(null);
  const [editing, setEditing] = useState<SerializedComment | null>(null);

  const comments = thread.data?.comments ?? [];

  const submit = useCallback(() => {
    const body = draft.trim();
    if (!body) return;
    if (editing) {
      update.mutate({ commentId: editing.id, body });
    } else {
      create.mutate({ body, parentCommentId: replyTo?.id });
    }
    setDraft("");
    setReplyTo(null);
    setEditing(null);
  }, [draft, editing, replyTo, create, update]);

  const startEdit = useCallback((c: SerializedComment) => {
    setEditing(c);
    setReplyTo(null);
    // The stored body is canonical; edit against the readable @label form.
    setDraft(parseMentions(c.body).display);
  }, []);

  const confirmDelete = useCallback(
    (c: SerializedComment) => {
      Alert.alert("Delete comment", "This cannot be undone.", [
        { text: "Cancel", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: () => remove.mutate(c.id) },
      ]);
    },
    [remove],
  );

  const onReact = useCallback(
    (c: SerializedComment, emoji: string) => {
      const existing = c.reactions.find((r) => r.emoji === emoji);
      toggleReaction.mutate({ commentId: c.id, emoji, add: !existing?.currentUserReacted });
    },
    [toggleReaction],
  );

  const renderItem = useCallback(
    ({ item }: { item: SerializedComment }) => (
      <CommentNode
        comment={item}
        T={T}
        currentUserId={user?.id ?? ""}
        color={color}
        onReply={(c) => {
          setReplyTo(c);
          setEditing(null);
        }}
        onEdit={startEdit}
        onDelete={confirmDelete}
        onResolveToggle={(c) => setResolved.mutate({ commentId: c.id, resolved: !c.isResolved })}
        onReact={onReact}
      />
    ),
    [T, user?.id, color, startEdit, confirmDelete, setResolved, onReact],
  );

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalRoot}>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={[styles.sheet, { backgroundColor: T.pageBg }]}
        >
          <View style={[styles.sheetHeader, { borderBottomColor: T.border }]}>
            <View style={[styles.handle, { backgroundColor: T.border }]} />
            <View style={styles.sheetHeaderRow}>
              <Text style={[styles.sheetTitle, { color: T.textBright }]}>
                Comments{thread.data ? ` (${thread.data.totalCount})` : ""}
              </Text>
              <TouchableOpacity
                onPress={onClose}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <X size={20} color={T.textDim} weight="bold" />
              </TouchableOpacity>
            </View>
          </View>

          {thread.isLoading ? (
            <View style={styles.loadingWrap}>
              <ActivityIndicator color={color} />
            </View>
          ) : (
            <FlatList
              data={comments}
              renderItem={renderItem}
              keyExtractor={(item) => item.id}
              contentContainerStyle={
                comments.length === 0 ? styles.emptyContent : styles.listContent
              }
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              ListEmptyComponent={
                <View style={styles.empty}>
                  <ChatText size={34} color={color} weight="duotone" />
                  <Text style={[styles.emptyText, { color: T.textDim }]}>
                    No comments yet. Start the conversation.
                  </Text>
                </View>
              }
            />
          )}

          {(replyTo || editing) && (
            <View
              style={[styles.contextBar, { backgroundColor: T.surface, borderTopColor: T.border }]}
            >
              <Text style={[styles.contextText, { color: T.textDim }]} numberOfLines={1}>
                {editing ? "Editing comment" : `Replying to ${replyTo?.authorName}`}
              </Text>
              <TouchableOpacity
                onPress={() => {
                  setReplyTo(null);
                  setEditing(null);
                  setDraft("");
                }}
              >
                <X size={15} color={T.textDim} weight="bold" />
              </TouchableOpacity>
            </View>
          )}

          <View
            style={[
              styles.composer,
              {
                backgroundColor: T.surface,
                borderTopColor: T.border,
                paddingBottom: 8 + (insets.bottom || 4),
              },
            ]}
          >
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder="Add a comment..."
              placeholderTextColor={T.textDim}
              style={[
                styles.input,
                { color: T.textBright, backgroundColor: T.bg, borderColor: T.border },
              ]}
              multiline
            />
            <TouchableOpacity
              style={[styles.sendBtn, { backgroundColor: draft.trim() ? color : T.surfaceHover }]}
              onPress={submit}
              disabled={!draft.trim()}
              activeOpacity={0.8}
            >
              <PaperPlaneRight size={18} color={draft.trim() ? "#fff" : T.textDim} weight="fill" />
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

function CommentNode({
  comment,
  T,
  currentUserId,
  color,
  onReply,
  onEdit,
  onDelete,
  onResolveToggle,
  onReact,
  isReply,
}: {
  comment: SerializedComment;
  T: ThemeColors;
  currentUserId: string;
  color: string;
  onReply: (c: SerializedComment) => void;
  onEdit: (c: SerializedComment) => void;
  onDelete: (c: SerializedComment) => void;
  onResolveToggle: (c: SerializedComment) => void;
  onReact: (c: SerializedComment, emoji: string) => void;
  isReply?: boolean;
}) {
  const [showEmojis, setShowEmojis] = useState(false);
  const isOwn = comment.authorId === currentUserId;

  return (
    <View style={[styles.commentNode, isReply && { marginLeft: 38, marginTop: 10 }]}>
      <View style={styles.commentRow}>
        <Avatar
          name={comment.authorName}
          avatarUrl={comment.authorAvatarUrl ?? undefined}
          size={30}
        />
        <View style={{ flex: 1 }}>
          <View style={styles.commentHeader}>
            <Text style={[styles.author, { color: T.textBright }]} numberOfLines={1}>
              {comment.authorName}
            </Text>
            <Text style={[styles.time, { color: T.textDim }]}>
              {comment.timeLabel}
              {comment.isEdited ? " (edited)" : ""}
            </Text>
            {comment.isResolved && !isReply ? (
              <View style={[styles.resolvedTag, { backgroundColor: "#10b98122" }]}>
                <CheckCircle size={11} color="#10b981" weight="fill" />
                <Text style={styles.resolvedText}>Resolved</Text>
              </View>
            ) : null}
          </View>
          <MentionLine
            content={comment.body}
            textStyle={[styles.body, { color: T.text }]}
            wrapperStyle={styles.bodyMentionRow}
          />

          {comment.reactions.length > 0 ? (
            <View style={styles.reactionsRow}>
              {comment.reactions.map((r) => (
                <TouchableOpacity
                  key={r.emoji}
                  style={[
                    styles.reactionChip,
                    {
                      backgroundColor: r.currentUserReacted ? color + "22" : T.surface,
                      borderColor: r.currentUserReacted ? color : T.border,
                    },
                  ]}
                  onPress={() => onReact(comment, r.emoji)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.reactionEmoji}>{r.emoji}</Text>
                  <Text
                    style={[
                      styles.reactionCount,
                      { color: r.currentUserReacted ? color : T.textDim },
                    ]}
                  >
                    {r.count}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          ) : null}

          {showEmojis ? (
            <View style={[styles.emojiBar, { backgroundColor: T.surface, borderColor: T.border }]}>
              {QUICK_EMOJIS.map((emoji) => (
                <TouchableOpacity
                  key={emoji}
                  onPress={() => {
                    onReact(comment, emoji);
                    setShowEmojis(false);
                  }}
                >
                  <Text style={styles.emojiBig}>{emoji}</Text>
                </TouchableOpacity>
              ))}
            </View>
          ) : null}

          <View style={styles.actionRow}>
            <TouchableOpacity onPress={() => setShowEmojis((v) => !v)} style={styles.actionBtn}>
              <Smiley size={14} color={T.textDim} weight="duotone" />
              <Text style={[styles.actionText, { color: T.textDim }]}>React</Text>
            </TouchableOpacity>
            {!isReply ? (
              <TouchableOpacity onPress={() => onReply(comment)} style={styles.actionBtn}>
                <ArrowBendUpLeft size={14} color={T.textDim} weight="duotone" />
                <Text style={[styles.actionText, { color: T.textDim }]}>Reply</Text>
              </TouchableOpacity>
            ) : null}
            {!isReply ? (
              <TouchableOpacity onPress={() => onResolveToggle(comment)} style={styles.actionBtn}>
                <CheckCircle
                  size={14}
                  color={comment.isResolved ? "#10b981" : T.textDim}
                  weight="duotone"
                />
                <Text
                  style={[styles.actionText, { color: comment.isResolved ? "#10b981" : T.textDim }]}
                >
                  {comment.isResolved ? "Reopen" : "Resolve"}
                </Text>
              </TouchableOpacity>
            ) : null}
            {isOwn ? (
              <>
                <TouchableOpacity onPress={() => onEdit(comment)} style={styles.actionBtn}>
                  <Text style={[styles.actionText, { color: T.textDim }]}>Edit</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => onDelete(comment)} style={styles.actionBtn}>
                  <Text style={[styles.actionText, { color: "#FA5252" }]}>Delete</Text>
                </TouchableOpacity>
              </>
            ) : null}
          </View>
        </View>
      </View>

      {comment.replies.map((reply) => (
        <CommentNode
          key={reply.id}
          comment={reply}
          T={T}
          currentUserId={currentUserId}
          color={color}
          onReply={onReply}
          onEdit={onEdit}
          onDelete={onDelete}
          onResolveToggle={onResolveToggle}
          onReact={onReact}
          isReply
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  headerBtn: { padding: 2 },
  headerBadge: {
    position: "absolute",
    top: -6,
    right: -8,
    minWidth: 15,
    height: 15,
    borderRadius: 7.5,
    paddingHorizontal: 3,
    alignItems: "center",
    justifyContent: "center",
  },
  headerBadgeText: { color: "#fff", fontSize: 9, fontFamily: FONT.bold },
  modalRoot: { flex: 1, justifyContent: "flex-end" },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.5)" },
  sheet: { height: "86%", borderTopLeftRadius: 20, borderTopRightRadius: 20, overflow: "hidden" },
  sheetHeader: { borderBottomWidth: StyleSheet.hairlineWidth, paddingBottom: 10 },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    alignSelf: "center",
    marginTop: 8,
    marginBottom: 8,
  },
  sheetHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
  },
  sheetTitle: { fontSize: 16, fontFamily: FONT.bold },
  loadingWrap: { flex: 1, alignItems: "center", justifyContent: "center" },
  listContent: { padding: 16, gap: 18 },
  emptyContent: { flexGrow: 1 },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10, padding: 40 },
  emptyText: { fontSize: 14, fontFamily: FONT.regular, textAlign: "center" },
  commentNode: {},
  commentRow: { flexDirection: "row", gap: 10 },
  commentHeader: { flexDirection: "row", alignItems: "center", gap: 7, flexWrap: "wrap" },
  author: { fontSize: 13, fontFamily: FONT.semibold },
  time: { fontSize: 11, fontFamily: FONT.regular },
  resolvedTag: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  resolvedText: { fontSize: 10, fontFamily: FONT.semibold, color: "#10b981" },
  body: { fontSize: 14, fontFamily: FONT.regular, lineHeight: 20, marginTop: 3 },
  bodyMentionRow: { marginTop: 3 },
  reactionsRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 7 },
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
  emojiBar: {
    flexDirection: "row",
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    marginTop: 8,
    alignSelf: "flex-start",
  },
  emojiBig: { fontSize: 20 },
  actionRow: { flexDirection: "row", alignItems: "center", gap: 16, marginTop: 8 },
  actionBtn: { flexDirection: "row", alignItems: "center", gap: 4 },
  actionText: { fontSize: 12, fontFamily: FONT.medium },
  contextBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  contextText: { fontSize: 12, fontFamily: FONT.medium, flex: 1 },
  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    paddingHorizontal: 12,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  input: {
    flex: 1,
    maxHeight: 110,
    minHeight: 40,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 10,
    fontSize: 15,
    fontFamily: FONT.regular,
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
});
