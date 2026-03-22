/**
 * UnreadsView - Dedicated page showing all unread messages grouped by channel.
 *
 * Similar to Threads Inbox but for unreads. Shows each channel with unread
 * messages as a collapsible section with message previews. Users can mark
 * individual channels or all as read.
 */

import { useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Hash,
  Lock,
  Check,
  ChatTeardrop,
  Tray,
} from '@phosphor-icons/react';
import { useAppSelector, useAppDispatch } from '@/app/hooks';
import { cn } from '@/shared/utils/cn';
import { setActiveChannel } from '@/features/chat/store/chatChannelsSlice';
import { selectMessagesForChannel } from '@/features/chat/store/chatMessagesSlice';
import { formatRelativeTime } from '@/shared/utils/dateFormatting';
import { getMockUser } from '@/features/chat/mock/mockMembers';
import { MessageContent } from '@/features/chat/components/channel/MessageContent';
import type { ChatChannel, ChatMessage } from '@/features/chat/mock/types';

// Mock unread data - same as sidebar
const MOCK_UNREAD_COUNTS: Record<string, number> = {
  'ch-001': 3,
  'ch-002': 7,
  'ch-005': 1,
  'ch-007': 2,
  'ch-009': 4,
};

interface UnreadChannelSectionProps {
  channel: ChatChannel;
  unreadCount: number;
  onNavigate: (channelId: string) => void;
  onMarkRead: (channelId: string) => void;
}

function UnreadChannelSection({ channel, unreadCount, onNavigate, onMarkRead }: UnreadChannelSectionProps) {
  const messages = useAppSelector((state) => selectMessagesForChannel(state, channel.id));

  // Get the last N unread messages (mock: just take the last `unreadCount` messages)
  const unreadMessages = useMemo(
    () => messages.filter(m => m.rootId === null).slice(-unreadCount),
    [messages, unreadCount],
  );

  const isDm = channel.channelType === 'DIRECT' || channel.channelType === 'GROUP_DM';
  const isPrivate = channel.channelType === 'PRIVATE';
  const ChannelIcon = isDm ? ChatTeardrop : isPrivate ? Lock : Hash;

  return (
    <div className="border-b border-border/50">
      {/* Channel header */}
      <div className="flex items-center justify-between px-4 py-2 bg-muted/20">
        <button
          onClick={() => onNavigate(channel.id)}
          className="flex items-center gap-2 text-sm font-semibold text-foreground hover:text-primary transition-colors"
        >
          <ChannelIcon size={14} className="text-muted-foreground shrink-0" />
          <span>{isDm ? channel.name : `#${channel.name}`}</span>
          <span className="min-w-[18px] h-[18px] rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center">
            {unreadCount}
          </span>
        </button>
        <button
          onClick={() => onMarkRead(channel.id)}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded-md hover:bg-muted"
          title="Mark as read"
        >
          <Check size={12} />
          <span>Mark read</span>
        </button>
      </div>

      {/* Unread messages */}
      <div>
        {unreadMessages.map(message => (
          <UnreadMessageItem
            key={message.id}
            message={message}
            channelId={channel.id}
            onNavigate={onNavigate}
          />
        ))}
      </div>
    </div>
  );
}

function UnreadMessageItem({ message, channelId, onNavigate }: {
  message: ChatMessage;
  channelId: string;
  onNavigate: (channelId: string) => void;
}) {
  const sender = getMockUser(message.senderId);
  const senderName = sender?.fullName ?? 'Unknown User';
  const initials = senderName.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();

  return (
    <button
      onClick={() => onNavigate(channelId)}
      className="w-full text-left px-4 py-2 hover:bg-muted/30 transition-colors flex items-start gap-3"
    >
      {/* Avatar */}
      <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center shrink-0 mt-0.5 text-[10px] font-medium text-muted-foreground">
        {initials}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-semibold text-foreground">{senderName}</span>
          <span className="text-xs text-muted-foreground">{formatRelativeTime(message.createdAt)}</span>
        </div>
        <div className="mt-0.5 text-sm text-muted-foreground line-clamp-2">
          <MessageContent content={message.content} />
        </div>
      </div>
    </button>
  );
}

export function UnreadsView() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const channels = useAppSelector((state) => state.chatChannels.channels);

  const [markedRead, setMarkedRead] = useState<Set<string>>(new Set());

  const unreadChannels = useMemo(
    () => channels
      .filter(c => (MOCK_UNREAD_COUNTS[c.id] ?? 0) > 0 && !markedRead.has(c.id))
      .sort((a, b) => (b.lastMessageAt ?? '').localeCompare(a.lastMessageAt ?? '')),
    [channels, markedRead],
  );

  const handleNavigate = useCallback((channelId: string) => {
    dispatch(setActiveChannel(channelId));
    navigate(`/chat/${channelId}`);
  }, [dispatch, navigate]);

  const handleMarkRead = useCallback((channelId: string) => {
    setMarkedRead(prev => new Set([...prev, channelId]));
  }, []);

  const handleMarkAllRead = useCallback(() => {
    setMarkedRead(new Set(Object.keys(MOCK_UNREAD_COUNTS)));
  }, []);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-card">
        <span className="text-sm font-semibold text-foreground">Unreads</span>
        {unreadChannels.length > 0 && (
          <button
            onClick={handleMarkAllRead}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded-md hover:bg-muted"
          >
            <Check size={12} />
            <span>Mark all read</span>
          </button>
        )}
      </div>

      {/* Unread channels list */}
      <div className="flex-1 overflow-y-auto">
        {unreadChannels.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center text-muted-foreground">
              <Tray size={48} className="mx-auto mb-3 text-muted-foreground/30" />
              <p className="text-lg font-semibold text-foreground">All caught up</p>
              <p className="text-sm mt-1">You have no unread messages.</p>
            </div>
          </div>
        ) : (
          unreadChannels.map(channel => (
            <UnreadChannelSection
              key={channel.id}
              channel={channel}
              unreadCount={MOCK_UNREAD_COUNTS[channel.id] ?? 0}
              onNavigate={handleNavigate}
              onMarkRead={handleMarkRead}
            />
          ))
        )}
      </div>
    </div>
  );
}
