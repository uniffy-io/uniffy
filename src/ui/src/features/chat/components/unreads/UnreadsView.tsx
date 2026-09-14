import { useState, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Hash, Lock, Check, ChatTeardrop, Tray } from "@phosphor-icons/react";
import { useAppSelector, useAppDispatch } from "@/app/hooks";
import { SubjectAvatarById } from "@/components/subject";
import {
  setActiveChannel,
  selectChannels,
  updateUnreadCounts,
} from "@/features/chat/store/chatChannelsSlice";
import { selectMessagesForChannel } from "@/features/chat/store/chatMessagesSlice";
import { formatRelativeTime } from "@/shared/utils/dateFormatting";
import { MessageContent } from "@/features/chat/components/channel/MessageContent";
import { markChannelRead } from "@/features/chat/store/chatThunks";
import type { ChatChannel, ChatMessage } from "@/features/chat/types";

interface UnreadChannelSectionProps {
  channel: ChatChannel;
  unreadCount: number;
  onNavigate: (channelId: string) => void;
  onMarkRead: (channelId: string) => void;
}

function UnreadChannelSection({
  channel,
  unreadCount,
  onNavigate,
  onMarkRead,
}: UnreadChannelSectionProps) {
  const messages = useAppSelector((state) => selectMessagesForChannel(state, channel.id));

  const unreadMessages = useMemo(
    () => messages.filter((m) => m.rootId === null).slice(-unreadCount),
    [messages, unreadCount],
  );

  const isDm = channel.channelType === "DIRECT" || channel.channelType === "GROUP_DM";
  const isPrivate = channel.channelType === "PRIVATE";
  const ChannelIcon = isDm ? ChatTeardrop : isPrivate ? Lock : Hash;

  return (
    <div className="border-b border-border/50">
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

      <div>
        {unreadMessages.map((message) => (
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

function UnreadMessageItem({
  message,
  channelId,
  onNavigate,
}: {
  message: ChatMessage;
  channelId: string;
  onNavigate: (channelId: string) => void;
}) {
  const senderName = message.senderName ?? "Unknown User";

  return (
    <button
      onClick={() => onNavigate(channelId)}
      className="w-full text-left px-4 py-2 hover:bg-muted/30 transition-colors flex items-start gap-3"
    >
      <div className="shrink-0 mt-0.5">
        <SubjectAvatarById userId={message.senderId} displayName={senderName} size="sm" />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-semibold text-foreground">{senderName}</span>
          <span className="text-xs text-muted-foreground">
            {formatRelativeTime(message.createdAt)}
          </span>
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
  const channels = useAppSelector(selectChannels);

  const [markedRead, setMarkedRead] = useState<Set<string>>(new Set());

  const unreadChannels = useMemo(
    () =>
      channels
        .filter((c) => (c.unreadCount ?? 0) > 0 && !markedRead.has(c.id))
        .sort((a, b) => (b.lastMessageAt ?? "").localeCompare(a.lastMessageAt ?? "")),
    [channels, markedRead],
  );

  const handleNavigate = useCallback(
    (channelId: string) => {
      dispatch(setActiveChannel(channelId));
      navigate(`/chat/${channelId}`);
    },
    [dispatch, navigate],
  );

  // The server rejects an empty cursor, so a channel whose newest id has not
  // arrived yet stays in the list rather than reading as cleared.
  const handleMarkRead = useCallback(
    (channelId: string) => {
      const channel = channels.find((c) => c.id === channelId);
      if (!channel?.latestMessageId) return;
      dispatch(markChannelRead({ channelId, lastReadMessageId: channel.latestMessageId }));
      dispatch(updateUnreadCounts([{ channelId, unreadCount: 0, mentionCount: 0 }]));
      setMarkedRead((prev) => new Set([...prev, channelId]));
    },
    [dispatch, channels],
  );

  const handleMarkAllRead = useCallback(() => {
    const marked: string[] = [];
    for (const channel of unreadChannels) {
      if (!channel.latestMessageId) continue;
      dispatch(
        markChannelRead({
          channelId: channel.id,
          lastReadMessageId: channel.latestMessageId,
        }),
      );
      dispatch(updateUnreadCounts([{ channelId: channel.id, unreadCount: 0, mentionCount: 0 }]));
      marked.push(channel.id);
    }
    setMarkedRead((prev) => new Set([...prev, ...marked]));
  }, [dispatch, unreadChannels]);

  return (
    <div className="flex flex-col h-full">
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
          unreadChannels.map((channel) => (
            <UnreadChannelSection
              key={channel.id}
              channel={channel}
              unreadCount={channel.unreadCount ?? 0}
              onNavigate={handleNavigate}
              onMarkRead={handleMarkRead}
            />
          ))
        )}
      </div>
    </div>
  );
}
