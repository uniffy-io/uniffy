import { useEffect, useLayoutEffect, useRef, useCallback } from "react";
import { toast } from "sonner";
import { X, LinkSimple, CaretLeft } from "@phosphor-icons/react";
import { useAppSelector, useAppDispatch } from "@/app/hooks";
import { SectionRule } from "@/components/ui/collection";
import {
  closeThreadPanel,
  selectReplyToMessage,
  clearReplyToMessage,
} from "@/features/chat/store/chatUiSlice";
import {
  setActiveThread,
  selectActiveThreadId,
  selectActiveThreadMessages,
} from "@/features/chat/store/chatThreadsSlice";
import { fetchThreadMessages, sendMessage, stopAgentRun } from "@/features/chat/store/chatThunks";
import { selectTypingInThread, evictExpiredTyping } from "@/features/chat/store/chatMessagesSlice";
import { useDraftSync } from "@/features/chat/hooks/useDraftSync";
import { ComposeDock } from "@/features/chat/components/compose/ComposeDock";
import { MessageItem } from "@/features/chat/components/channel/MessageItem";
import { MessageCompose } from "@/features/chat/components/compose/MessageCompose";
import { TypingIndicator } from "@/features/chat/components/channel/TypingIndicator";

const headerButtonClass =
  "p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0";

interface ThreadPanelProps {
  /** Slide-over inside a split pane: a back arrow leads the header instead of a trailing X. */
  overlay?: boolean;
}

export function ThreadPanel({ overlay = false }: ThreadPanelProps) {
  const dispatch = useAppDispatch();
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);

  const activeThreadId = useAppSelector(selectActiveThreadId);
  const threadMessages = useAppSelector(selectActiveThreadMessages);
  const threadTyping = useAppSelector((state) =>
    activeThreadId ? selectTypingInThread(state, activeThreadId) : [],
  );

  const rootMessage = useAppSelector((state) =>
    activeThreadId ? (state.chatMessages.byId[activeThreadId] ?? null) : null,
  );

  const channelName = useAppSelector((state) => {
    if (!rootMessage) return "";
    const channel = state.chatChannels.byId[rootMessage.channelId];
    return channel ? `#${channel.name}` : "";
  });
  const organizationId = useAppSelector((state) => state.auth.currentOrganizationId);

  useEffect(() => {
    if (activeThreadId && rootMessage) {
      dispatch(
        fetchThreadMessages({
          channelId: rootMessage.channelId,
          rootMessageId: activeThreadId,
        }),
      );
    }
  }, [activeThreadId, rootMessage, dispatch]);

  useEffect(() => {
    if (!activeThreadId || threadTyping.length === 0) return;
    const timer = setInterval(() => {
      dispatch(evictExpiredTyping({ rootId: activeThreadId }));
    }, 2000);
    return () => clearInterval(timer);
  }, [dispatch, activeThreadId, threadTyping.length]);

  useLayoutEffect(() => {
    stickToBottomRef.current = true;
  }, [activeThreadId]);

  // Re-stick to bottom on content-height changes so async image/mention layout doesn't strand the user above the latest reply.
  useEffect(() => {
    const scrollEl = scrollRef.current;
    const contentEl = contentRef.current;
    if (!scrollEl || !contentEl) return;

    const scrollToBottom = () => {
      if (stickToBottomRef.current) {
        scrollEl.scrollTop = scrollEl.scrollHeight;
      }
    };

    const onScroll = () => {
      const distanceFromBottom = scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight;
      stickToBottomRef.current = distanceFromBottom < 40;
    };

    scrollEl.addEventListener("scroll", onScroll, { passive: true });
    const observer = new ResizeObserver(scrollToBottom);
    observer.observe(contentEl);
    scrollToBottom();

    return () => {
      scrollEl.removeEventListener("scroll", onScroll);
      observer.disconnect();
    };
  }, [activeThreadId]);

  const handleClose = useCallback(() => {
    dispatch(closeThreadPanel());
    dispatch(setActiveThread(null));
  }, [dispatch]);

  const handleCopyThreadLink = useCallback(async () => {
    if (!rootMessage) return;
    const url = `${window.location.origin}/chat/${rootMessage.channelId}#${rootMessage.id}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Thread link copied");
    } catch {
      toast.error("Failed to copy link");
    }
  }, [rootMessage]);

  const replyToMessage = useAppSelector(selectReplyToMessage);
  const { initialDraft, remoteDraft, onDraftChange, flushOnSend } = useDraftSync(
    rootMessage?.channelId ?? null,
    activeThreadId ?? undefined,
  );

  const handleSend = useCallback(
    async (content: string, fileIds: string[], metadata?: Record<string, string>) => {
      if (!activeThreadId || !rootMessage) return false;
      await dispatch(
        sendMessage({
          channelId: rootMessage.channelId,
          content,
          rootId: activeThreadId,
          replyToId: replyToMessage?.id,
          attachmentFileIds: fileIds,
          metadata,
        }),
      ).unwrap();
      flushOnSend();
      dispatch(clearReplyToMessage());
      return true;
    },
    [activeThreadId, rootMessage, replyToMessage, dispatch, flushOnSend],
  );

  const handleCancelReply = useCallback(() => {
    dispatch(clearReplyToMessage());
  }, [dispatch]);

  const handleStopAgent = useCallback(
    (agentId: string) => {
      if (!rootMessage) return;
      dispatch(stopAgentRun({ channelId: rootMessage.channelId, agentId }));
    },
    [rootMessage, dispatch],
  );

  if (!activeThreadId) {
    return null;
  }

  const backButton = overlay ? (
    <button
      type="button"
      onClick={handleClose}
      className={headerButtonClass}
      aria-label="Back to channel"
      data-testid="chat-thread-close"
    >
      <CaretLeft size={16} weight="bold" />
    </button>
  ) : null;

  const closeButton = overlay ? null : (
    <button
      type="button"
      onClick={handleClose}
      className={headerButtonClass}
      aria-label="Close thread"
      data-testid="chat-thread-close"
    >
      <X size={16} />
    </button>
  );

  if (!rootMessage) {
    return (
      <div className="flex flex-col h-full bg-surface">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border-strong">
          {backButton}
          <span className="flex-1 text-sm font-semibold text-foreground">Thread</span>
          {closeButton}
        </div>
        <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
          Message not found
        </div>
      </div>
    );
  }

  const replyCount = threadMessages.length;

  return (
    <div
      className="flex flex-col h-full bg-surface"
      data-testid="chat-thread-panel"
      data-thread-root-id={activeThreadId}
      data-overlay={overlay ? "true" : undefined}
    >
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border-strong">
        {backButton}
        <div className="flex min-w-0 flex-1 items-baseline gap-2">
          <span className="text-sm font-semibold text-foreground">Thread</span>
          {channelName && (
            <button
              type="button"
              onClick={handleCopyThreadLink}
              title="Copy thread link"
              className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors"
              data-testid="chat-thread-copy-link"
            >
              <span className="truncate">{channelName}</span>
              <LinkSimple size={10} className="shrink-0" />
            </button>
          )}
        </div>
        {closeButton}
      </div>

      <div className="relative flex min-h-0 flex-1 flex-col">
        <div ref={scrollRef} className="flex-1 overflow-y-auto" data-testid="chat-thread-scroll">
          <div
            ref={contentRef}
            // Room for the floating composer plus the typing slot above it.
            style={{ paddingBottom: "calc(var(--chat-compose-reserve, 0px) + 2.5rem)" }}
            data-testid="chat-thread-messages"
            data-reply-count={replyCount}
          >
            <div className="mx-4 mt-4 rounded-xl bg-card shadow-edge [&>*]:rounded-xl [&>*]:py-3">
              <MessageItem message={rootMessage} isGrouped={false} isFirstInGroup={true} />
            </div>

            {replyCount > 0 && (
              <div className="px-4 pt-5">
                <SectionRule label={replyCount === 1 ? "Reply" : "Replies"} count={replyCount} />
              </div>
            )}

            {threadMessages.map((reply, index) => {
              const prevReply = index > 0 ? threadMessages[index - 1] : null;
              const isGrouped =
                prevReply !== null &&
                prevReply.senderId === reply.senderId &&
                new Date(reply.createdAt).getTime() - new Date(prevReply.createdAt).getTime() <
                  300000;

              return (
                <MessageItem
                  key={reply.id}
                  message={reply}
                  isGrouped={isGrouped}
                  isFirstInGroup={!isGrouped}
                />
              );
            })}
          </div>
        </div>

        <div
          className="pointer-events-none absolute inset-x-0 z-10"
          style={{ bottom: "var(--chat-compose-reserve, 0px)" }}
        >
          <div className="pointer-events-auto">
            <TypingIndicator typingUsers={threadTyping} onStopAgent={handleStopAgent} />
          </div>
        </div>
        <ComposeDock testId="chat-thread-compose-dock">
          <MessageCompose
            // Remount per thread so one thread's text never leaks into another.
            key={`${organizationId}:${activeThreadId}`}
            channelName=""
            // Channel + org context feed the broadcast/team-mention guards and
            // attachment uploads.
            channelId={rootMessage?.channelId}
            threadRootId={activeThreadId ?? undefined}
            organizationId={organizationId ?? undefined}
            placeholder="Reply..."
            onSend={handleSend}
            replyTo={replyToMessage}
            onCancelReply={handleCancelReply}
            initialDraft={initialDraft}
            remoteDraft={remoteDraft}
            onDraftChange={onDraftChange}
          />
        </ComposeDock>
      </div>
    </div>
  );
}
