import { useState, useCallback } from 'react';
import { ChatText } from '@phosphor-icons/react';
import { useNavigate } from 'react-router-dom';
import { useAppSelector, useAppDispatch } from '@/app/hooks';
import { cn } from '@/shared/utils/cn';
import { selectThreadsInbox } from '@/features/chat/store/chatThreadsSlice';
import { setActiveChannel } from '@/features/chat/store/chatChannelsSlice';
import { openThreadPanel } from '@/features/chat/store/chatUiSlice';
import { setActiveThread } from '@/features/chat/store/chatThreadsSlice';
import { ThreadInboxItem } from '@/features/chat/components/thread/ThreadInboxItem';

type InboxFilter = 'all' | 'unreads';

export function ThreadsInbox() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const [filter, setFilter] = useState<InboxFilter>('all');

  const threadsInbox = useAppSelector(selectThreadsInbox);

  const filteredThreads = filter === 'unreads'
    ? threadsInbox.filter(t => t.hasUnread)
    : threadsInbox;

  const handleThreadClick = useCallback((thread: { rootMessageId: string; channelId: string }) => {
    dispatch(setActiveChannel(thread.channelId));
    dispatch(setActiveThread(thread.rootMessageId));
    dispatch(openThreadPanel());
    navigate(`/chat/${thread.channelId}`);
  }, [dispatch, navigate]);

  return (
    <div className="flex flex-col h-full" data-testid="chat-threads-inbox" data-filter={filter}>
      <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-card">
        <span className="text-sm font-semibold text-foreground">Threads</span>
      </div>

      <div className="flex gap-1 px-4 py-2 border-b border-border">
        <button
          onClick={() => setFilter('all')}
          className={cn(
            "rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
            filter === 'all'
              ? "bg-primary/10 text-primary"
              : "text-muted-foreground hover:text-foreground hover:bg-muted"
          )}
          data-testid="chat-threads-inbox-tab-all"
          data-active={filter === 'all' ? 'true' : 'false'}
        >
          All Threads
        </button>
        <button
          onClick={() => setFilter('unreads')}
          className={cn(
            "rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
            filter === 'unreads'
              ? "bg-primary/10 text-primary"
              : "text-muted-foreground hover:text-foreground hover:bg-muted"
          )}
          data-testid="chat-threads-inbox-tab-unreads"
          data-active={filter === 'unreads' ? 'true' : 'false'}
        >
          Unreads
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {filteredThreads.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center text-muted-foreground">
              <ChatText size={48} className="mx-auto mb-3 text-muted-foreground/30" />
              <p className="text-lg font-semibold text-foreground">
                {filter === 'unreads' ? 'All caught up' : 'No threads yet'}
              </p>
              <p className="text-sm mt-1">
                {filter === 'unreads'
                  ? 'You have no unread threads.'
                  : 'Threads you start or follow will appear here.'}
              </p>
            </div>
          </div>
        ) : (
          <div>
            {filteredThreads.map(thread => (
              <ThreadInboxItem
                key={thread.rootMessageId}
                thread={thread}
                onClick={() => handleThreadClick(thread)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
