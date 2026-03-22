/**
 * ThreadPanel - Right-hand side panel for viewing and replying to threads.
 *
 * Shows the root message at top, a reply count separator, then all replies.
 * Compose box at the bottom for replying.
 */

import { useEffect, useRef, useCallback } from 'react';
import { X, ArrowSquareOut } from '@phosphor-icons/react';
import { useAppSelector, useAppDispatch } from '@/app/hooks';
import { closeThreadPanel } from '@/features/chat/store/chatUiSlice';
import {
  setActiveThread,
  selectActiveThreadId,
  selectActiveThreadMessages,
  setThreadMessages,
  appendThreadMessage,
} from '@/features/chat/store/chatThreadsSlice';
import { getThreadMessages } from '@/features/chat/mock/mockThreads';
import { CURRENT_USER_ID } from '@/features/chat/mock/mockMembers';
import { MessageItem } from '@/features/chat/components/channel/MessageItem';
import { MessageCompose } from '@/features/chat/components/compose/MessageCompose';

export function ThreadPanel() {
  const dispatch = useAppDispatch();
  const scrollRef = useRef<HTMLDivElement>(null);

  const activeThreadId = useAppSelector(selectActiveThreadId);
  const threadMessages = useAppSelector(selectActiveThreadMessages);

  // Find the root message from the channel messages
  const rootMessage = useAppSelector((state) => {
    if (!activeThreadId) return null;
    for (const messages of Object.values(state.chatMessages.messagesByChannel)) {
      const found = messages.find(m => m.id === activeThreadId);
      if (found) return found;
    }
    return null;
  });

  // Find the channel name for the header
  const channelName = useAppSelector((state) => {
    if (!rootMessage) return '';
    const channel = state.chatChannels.channels.find(c => c.id === rootMessage.channelId);
    return channel ? `#${channel.name}` : '';
  });

  // Load thread messages when thread opens
  useEffect(() => {
    if (activeThreadId) {
      const messages = getThreadMessages(activeThreadId);
      dispatch(setThreadMessages({ rootMessageId: activeThreadId, messages }));
    }
  }, [activeThreadId, dispatch]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [threadMessages.length]);

  const handleClose = useCallback(() => {
    dispatch(closeThreadPanel());
    dispatch(setActiveThread(null));
  }, [dispatch]);

  const handleSend = useCallback((content: string) => {
    if (!activeThreadId) return;
    const newReply = {
      id: `msg-reply-${Date.now()}`,
      channelId: rootMessage?.channelId ?? '',
      senderId: CURRENT_USER_ID,
      senderType: 'USER' as const,
      content,
      rootId: activeThreadId,
      editedAt: null,
      isDeleted: false,
      isPinned: false,
      metadata: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    dispatch(appendThreadMessage({ rootMessageId: activeThreadId, message: newReply }));
  }, [activeThreadId, rootMessage, dispatch]);

  if (!activeThreadId) {
    return null;
  }

  // If root message not found (edge case), show a minimal state
  if (!rootMessage) {
    return (
      <div className="flex flex-col h-full bg-card">
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
    <div className="flex flex-col h-full bg-card">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-semibold text-foreground">Thread</span>
          {channelName && (
            <button className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors truncate">
              <span className="truncate">{channelName}</span>
              <ArrowSquareOut size={10} />
            </button>
          )}
        </div>
        <button
          onClick={handleClose}
          className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0"
        >
          <X size={16} />
        </button>
      </div>

      {/* Scrollable content */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {/* Root message */}
        <div className="border-b border-border">
          <MessageItem
            message={rootMessage}
            isGrouped={false}
            isFirstInGroup={true}
          />
        </div>

        {/* Reply count separator */}
        {replyCount > 0 && (
          <div className="flex items-center gap-3 px-4 py-2">
            <div className="flex-1 border-t border-border" />
            <span className="text-xs text-muted-foreground font-medium whitespace-nowrap">
              {replyCount} {replyCount === 1 ? 'reply' : 'replies'}
            </span>
            <div className="flex-1 border-t border-border" />
          </div>
        )}

        {/* Thread replies */}
        {threadMessages.map((reply, index) => {
          const prevReply = index > 0 ? threadMessages[index - 1] : null;
          const isGrouped = prevReply !== null
            && prevReply.senderId === reply.senderId
            && new Date(reply.createdAt).getTime() - new Date(prevReply.createdAt).getTime() < 300000;

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

      {/* Thread compose */}
      <MessageCompose
        channelName=""
        placeholder="Reply..."
        onSend={handleSend}
      />
    </div>
  );
}
