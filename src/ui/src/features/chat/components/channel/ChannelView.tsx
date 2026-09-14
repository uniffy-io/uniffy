import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Hash, Trash } from "@phosphor-icons/react";
import { cn } from "@/shared/utils/cn";
import { useAppSelector, useAppDispatch } from "@/app/hooks";
import { ChannelHeader } from "@/features/chat/components/channel/ChannelHeader";
import {
  AgentAuroraBackdrop,
  AgentDmGreeting,
  AgentDmHero,
} from "@/features/chat/components/channel/AgentDmHero";
import { MessageList } from "@/features/chat/components/channel/MessageList";
import { MessageCompose } from "@/features/chat/components/compose/MessageCompose";
import { getChannelDisplayName } from "@/features/chat/utils/channelDisplay";
import { sendMessage, sendTyping, editMessage } from "@/features/chat/store/chatThunks";
import { updateMessage } from "@/features/chat/store/chatMessagesSlice";
import {
  selectReplyToMessage,
  clearReplyToMessage,
  selectEditingMessage,
  clearEditingMessage,
  setEditingMessage,
  selectThreadPane,
} from "@/features/chat/store/chatUiSlice";
import { ThreadSlideOver } from "@/features/chat/components/thread/ThreadSlideOver";
import { useBreakpoint } from "@/shared/hooks/useBreakpoint";
import { useBookmarkStatuses } from "@/features/bookmarks";
import { selectMessagesForChannel } from "@/features/chat/store/chatMessagesSlice";
import { useDraftSync } from "@/features/chat/hooks/useDraftSync";
import { ComposeDock } from "@/features/chat/components/compose/ComposeDock";
import { useJoinCallParam } from "@/features/chat/hooks/useJoinCallParam";
import { attachmentsApi } from "@/features/files/api/attachmentsApi";
import { ContentType } from "@uniffy/proto/common/v1/common_pb";
import { CallSection } from "@/features/calls/components/CallView";

const TYPING_THROTTLE_MS = 3000;

interface ChannelViewProps {
  channelId?: string;
  /** Which split pane this view fills; decides which pane hosts the thread slide-over. */
  pane?: "left" | "right";
  onFocus?: () => void;
  showCloseButton?: boolean;
  onClose?: () => void;
}

export function ChannelView({
  channelId: channelIdProp,
  pane = "left",
  onFocus,
  showCloseButton,
  onClose,
}: ChannelViewProps) {
  const dispatch = useAppDispatch();
  const lastTypingSentRef = useRef(0);

  const activeChannelIdFromRedux = useAppSelector((state) => state.chatChannels.activeChannelId);
  const effectiveChannelId = channelIdProp ?? activeChannelIdFromRedux;
  const organizationId = useAppSelector((state) => state.auth.currentOrganizationId);

  useJoinCallParam(effectiveChannelId);

  const activeChannel = useAppSelector((state) =>
    effectiveChannelId ? state.chatChannels.byId[effectiveChannelId] : undefined,
  );
  const replyToMessage = useAppSelector(selectReplyToMessage);
  const editingMessage = useAppSelector(selectEditingMessage);
  const currentUserId = useAppSelector((state) => state.auth.user?.id);
  const channelMessages = useAppSelector((state) =>
    effectiveChannelId ? selectMessagesForChannel(state, effectiveChannelId) : null,
  );
  // Raw ids distinguish "never fetched" (undefined) from "fetched, empty" ([]).
  const messageIds = useAppSelector((state) =>
    effectiveChannelId ? state.chatMessages.idsByChannel[effectiveChannelId] : undefined,
  );
  const dmAgent = useAppSelector((state) =>
    activeChannel?.isAgentDm && activeChannel.agentId
      ? (state.agents.agents[activeChannel.agentId] ?? null)
      : null,
  );

  const messageBookmarkUrns = useMemo(
    () => messageIds?.map((id) => `urn:uniffy:content:CHAT_MESSAGE:${id}`) ?? [],
    [messageIds],
  );
  useBookmarkStatuses(messageBookmarkUrns);

  const threadPane = useAppSelector(selectThreadPane);
  const { isMobileOrTablet } = useBreakpoint();
  const hostsThread = threadPane === pane && !isMobileOrTablet;

  const isAgentDm = !!activeChannel?.isAgentDm && !!activeChannel?.agentId;
  let heroPhase: "off" | "pending" | "hero" = "off";
  if (isAgentDm) {
    if (messageIds === undefined) heroPhase = "pending";
    else if (messageIds.length === 0) heroPhase = "hero";
  }

  // Brief farewell overlay when the first message flips hero -> conversation:
  // the greeting lifts out while the list and composer rise in.
  const [heroExit, setHeroExit] = useState(false);
  const prevHeroPhaseRef = useRef(heroPhase);
  useEffect(() => {
    const prev = prevHeroPhaseRef.current;
    prevHeroPhaseRef.current = heroPhase;
    if (prev === "hero" && heroPhase === "off") {
      setHeroExit(true);
      const timer = setTimeout(() => setHeroExit(false), 550);
      return () => clearTimeout(timer);
    }
  }, [heroPhase]);

  const { initialDraft, remoteDraft, onDraftChange, flushOnSend } = useDraftSync(
    effectiveChannelId ?? null,
  );

  const handleSend = useCallback(
    async (content: string, fileIds: string[], metadata?: Record<string, string>) => {
      if (!activeChannel || !effectiveChannelId) return false;
      const result = await dispatch(
        sendMessage({
          channelId: effectiveChannelId,
          content: content || "",
          replyToId: replyToMessage?.id,
          attachmentFileIds: fileIds,
          metadata,
        }),
      ).unwrap();
      flushOnSend();
      dispatch(clearReplyToMessage());

      if (fileIds.length > 0 && organizationId && result.id) {
        try {
          const response = await attachmentsApi.listAttachments({
            organizationId,
            contentType: ContentType.CHAT_MESSAGE,
            contentId: result.id,
          });
          const attachments = response.attachments.map((a) => ({
            id: a.id,
            fileId: a.fileId,
            sourceFileId: a.sourceFileId || undefined,
            filename: a.filename,
            mimeType: a.mimeType,
            sizeBytes: Number(a.sizeBytes),
          }));
          if (attachments.length > 0) {
            dispatch(
              updateMessage({
                channelId: effectiveChannelId,
                message: { ...result, attachments },
              }),
            );
          }
        } catch (err) {
          console.error("[ChannelView] Failed to load attachments for sent message:", err);
        }
      }
      return true;
    },
    [activeChannel, effectiveChannelId, replyToMessage, dispatch, organizationId, flushOnSend],
  );

  const handleCancelReply = useCallback(() => {
    dispatch(clearReplyToMessage());
  }, [dispatch]);

  const handleEdit = useCallback(
    async (content: string) => {
      if (!editingMessage) return;
      await dispatch(
        editMessage({
          channelId: editingMessage.channelId,
          messageId: editingMessage.id,
          content,
        }),
      );
      dispatch(clearEditingMessage());
    },
    [editingMessage, dispatch],
  );

  const handleCancelEdit = useCallback(() => {
    dispatch(clearEditingMessage());
  }, [dispatch]);

  const handleEditLast = useCallback(() => {
    if (!effectiveChannelId || !currentUserId || !channelMessages) return;
    for (let i = channelMessages.length - 1; i >= 0; i--) {
      const msg = channelMessages[i];
      if (msg.senderId === currentUserId && !msg.isDeleted) {
        dispatch(
          setEditingMessage({
            id: msg.id,
            channelId: effectiveChannelId,
            content: msg.content,
          }),
        );
        return;
      }
    }
  }, [effectiveChannelId, currentUserId, channelMessages, dispatch]);

  const handleTyping = useCallback(() => {
    if (!effectiveChannelId) return;
    const now = Date.now();
    if (now - lastTypingSentRef.current < TYPING_THROTTLE_MS) return;
    lastTypingSentRef.current = now;
    dispatch(sendTyping(effectiveChannelId));
  }, [effectiveChannelId, dispatch]);

  if (!activeChannel) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        <div className="text-center">
          <Hash size={48} className="mx-auto mb-3 text-muted-foreground/30" />
          <p className="text-lg font-semibold text-foreground">Welcome to Chat</p>
          <p className="text-sm mt-1">Select a channel from the sidebar to start messaging.</p>
        </div>
      </div>
    );
  }

  const resolvedName = getChannelDisplayName(activeChannel);
  const channelDisplayName =
    activeChannel.channelType === "DIRECT" || activeChannel.channelType === "GROUP_DM"
      ? resolvedName
      : `#${resolvedName}`;

  // A deleted agent's DM is frozen: the history is the user's own work, but
  // there is nobody left to answer, so the composer gives way to a notice.
  const agentRetired = !!activeChannel.isAgentDm && !!activeChannel.agentIsRetired;

  const retiredNotice = (
    <div
      className="mx-4 mb-4 flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2.5 text-xs text-muted-foreground"
      data-testid="chat-agent-retired-notice"
    >
      <Trash size={14} className="shrink-0" />
      <span>
        {resolvedName} was deleted. This conversation stays readable, but no new messages can be
        sent.
      </span>
    </div>
  );

  const compose = activeChannel.isArchived ? (
    <p className="px-4 py-3 text-sm text-muted-foreground" data-testid="chat-archived-notice">
      This channel is archived. History remains readable. An owner or admin can restore it.
    </p>
  ) : agentRetired ? (
    retiredNotice
  ) : (
    <MessageCompose
      // Remount per channel: the contentEditable DOM would otherwise carry
      // one channel's text into another and corrupt its draft.
      key={`${organizationId}:${effectiveChannelId ?? "none"}`}
      channelName={channelDisplayName}
      channelId={effectiveChannelId ?? undefined}
      organizationId={organizationId ?? undefined}
      onSend={handleSend}
      onTyping={handleTyping}
      replyTo={replyToMessage}
      onCancelReply={handleCancelReply}
      editingMessage={editingMessage}
      onSaveEdit={handleEdit}
      onCancelEdit={handleCancelEdit}
      onEditLast={handleEditLast}
      initialDraft={initialDraft}
      remoteDraft={remoteDraft}
      onDraftChange={onDraftChange}
      variant={heroPhase === "hero" ? "hero" : "bar"}
    />
  );

  return (
    <div
      className="relative isolate flex flex-col h-full"
      onMouseDown={onFocus}
      data-testid="chat-channel-view"
      data-channel-id={effectiveChannelId ?? ""}
    >
      <AgentAuroraBackdrop intensity={isAgentDm && heroPhase !== "off" ? "hero" : "flat"} />
      <ChannelHeader
        channelId={effectiveChannelId ?? undefined}
        showCloseButton={showCloseButton}
        onClose={onClose}
        bare={heroPhase !== "off"}
      />
      {effectiveChannelId && <CallSection channelId={effectiveChannelId} />}
      {heroPhase === "off" && (
        <div className={cn("relative flex min-h-0 flex-1 flex-col", heroExit && "hero-enter")}>
          <MessageList channelId={effectiveChannelId ?? undefined} />
          <ComposeDock testId="chat-compose-dock">{compose}</ComposeDock>
          {heroExit && (
            <div className="pointer-events-none absolute inset-0 z-20 flex flex-col items-center justify-center gap-7 px-4 py-10">
              <AgentDmGreeting
                agentName={resolvedName}
                avatarKey={dmAgent?.avatarKey}
                avatarEmoji={dmAgent?.avatarEmoji}
                exiting
              />
              <div className="h-28 w-full max-w-2xl" />
            </div>
          )}
        </div>
      )}
      {heroPhase === "hero" && (
        <AgentDmHero
          agentName={resolvedName}
          avatarKey={dmAgent?.avatarKey}
          avatarEmoji={dmAgent?.avatarEmoji}
        >
          {compose}
        </AgentDmHero>
      )}
      {heroPhase === "pending" && <div className="flex-1" />}
      {hostsThread && <ThreadSlideOver />}
    </div>
  );
}
