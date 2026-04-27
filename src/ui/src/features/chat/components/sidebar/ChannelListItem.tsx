/**
 * ChannelListItem - Single channel row in the sidebar.
 *
 * Shows hash/lock icon, channel name, muted indicator, unread badge, and mention badge.
 * Supports right-click context menu for split view and notification settings.
 */

import { useState, useCallback } from 'react';
import { Hash, Lock, SpeakerSlash } from '@phosphor-icons/react';
import { cn } from '@/shared/utils/cn';
import { type ChatChannel } from '@/features/chat/types';
import { ChannelContextMenu } from '@/features/chat/components/sidebar/ChannelContextMenu';

interface ChannelListItemProps {
  channel: ChatChannel;
  isActive: boolean;
  unreadCount?: number;
  mentionCount?: number;
  isMuted?: boolean;
  onClick: () => void;
}

export function ChannelListItem({
  channel,
  isActive,
  unreadCount = 0,
  mentionCount = 0,
  isMuted = false,
  onClick,
}: ChannelListItemProps) {
  const isPrivate = channel.channelType === 'PRIVATE';
  const hasUnread = unreadCount > 0;
  const Icon = isPrivate ? Lock : Hash;

  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY });
  }, []);

  return (
    <>
      <button
        onClick={onClick}
        onContextMenu={handleContextMenu}
        className={cn(
          "flex items-center gap-2 w-full px-3 py-1.5 rounded-md mx-1.5 cursor-pointer transition-colors text-left",
          "max-w-[calc(100%-12px)]",
          isActive
            ? "bg-primary/10 text-primary font-medium"
            : isMuted
              ? "text-muted-foreground/60 hover:bg-accent hover:text-muted-foreground"
              : hasUnread
                ? "font-semibold text-foreground hover:bg-accent"
                : "text-foreground/90 hover:bg-accent hover:text-foreground"
        )}
        data-testid={`chat-sidebar-channel-${channel.id}`}
        data-channel-type={isPrivate ? 'private' : 'public'}
        data-active={isActive ? 'true' : 'false'}
        data-muted={isMuted ? 'true' : 'false'}
        data-unread={hasUnread ? 'true' : 'false'}
      >
        <Icon
          size={isPrivate ? 12 : 14}
          className={cn(
            "shrink-0",
            isActive ? "text-primary" : "text-muted-foreground"
          )}
        />

        <span
          className="truncate text-[0.9rem] flex-1"
          data-testid={`chat-sidebar-channel-name-${channel.id}`}
        >
          {channel.name}
        </span>

        {isMuted && (
          <SpeakerSlash size={12} className="shrink-0 text-muted-foreground/50" />
        )}

        {mentionCount > 0 && (
          <span
            className="min-w-[18px] h-[18px] rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center shrink-0"
            data-testid={`chat-sidebar-channel-mention-badge-${channel.id}`}
          >
            {mentionCount}
          </span>
        )}

        {hasUnread && mentionCount === 0 && !isMuted && (
          <span
            className="w-2 h-2 rounded-full bg-primary shrink-0"
            data-testid={`chat-sidebar-channel-unread-badge-${channel.id}`}
          />
        )}
      </button>

      {contextMenu && (
        <ChannelContextMenu
          channelId={channel.id}
          position={contextMenu}
          onClose={() => setContextMenu(null)}
        />
      )}
    </>
  );
}
