import { useEffect, useLayoutEffect, useRef, useCallback } from "react";
import { toast } from "sonner";
import { X, LinkSimple } from "@phosphor-icons/react";
import { useAppSelector, useAppDispatch } from "@/app/hooks";
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
import { MessageItem } from "@/features/chat/components/channel/MessageItem";
import { MessageCompose } from "@/features/chat/components/compose/MessageCompose";
import { TypingIndicator } from "@/features/chat/components/channel/TypingIndicator";

export function ThreadPanel() {
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
    (content: string) => {
      if (!activeThreadId || !rootMessage) return;
      flushOnSend();
      dispatch(
        sendMessage({
          channelId: rootMessage.channelId,
          content,
          rootId: activeThreadId,
          replyToId: replyToMessage?.id,
        }),
      );
      dispatch(clearReplyToMessage());
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

  if (!rootMessage) {
    return (
      <div className="flex flex-col h-full bg-background">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <span className="text-sm font-semibold text-foreground">Thread</span>
          <button
            onClick={handleClose}
            className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0"
          >
            <X size={16} />
          </button>
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
      className="flex flex-col h-full bg-background"
      data-testid="chat-thread-panel"
      data-thread-root-id={activeThreadId}
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-semibold text-foreground">Thread</span>
          {channelName && (
            <button
              onClick={handleCopyThreadLink}
              title="Copy thread link"
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors truncate"
              data-testid="chat-thread-copy-link"
            >
              <span className="truncate">{channelName}</span>
              <LinkSimple size={10} />
            </button>
          )}
        </div>
        <button
          onClick={handleClose}
          className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0"
          data-testid="chat-thread-close"
        >
          <X size={16} />
        </button>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto" data-testid="chat-thread-scroll">
        <div ref={contentRef} data-testid="chat-thread-messages" data-reply-count={replyCount}>
          <div className="border-b border-border">
            <MessageItem message={rootMessage} isGrouped={false} isFirstInGroup={true} />
          </div>

          {replyCount > 0 && (
            <div className="flex items-center gap-3 px-4 py-2">
              <div className="flex-1 border-t border-border" />
              <span className="text-xs text-muted-foreground font-medium whitespace-nowrap">
                {replyCount} {replyCount === 1 ? "reply" : "replies"}
              </span>
              <div className="flex-1 border-t border-border" />
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

      <TypingIndicator typingUsers={threadTyping} onStopAgent={handleStopAgent} />

      <MessageCompose
        // Remount per thread so one thread's text never leaks into another.
        key={activeThreadId}
        channelName=""
        placeholder="Reply..."
        onSend={handleSend}
        replyTo={replyToMessage}
        onCancelReply={handleCancelReply}
        initialDraft={initialDraft}
        remoteDraft={remoteDraft}
        onDraftChange={onDraftChange}
      />
    </div>
  );
}
