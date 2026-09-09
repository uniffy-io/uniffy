import { memo, useState, useCallback } from "react";
import { Hash, Lock, PencilSimple, SpeakerSlash } from "@phosphor-icons/react";
import { cn } from "@/shared/utils/cn";
import { type ChatChannel } from "@/features/chat/types";
import { ChannelContextMenu } from "@/features/chat/components/sidebar/ChannelContextMenu";
import { ChannelCallIndicator } from "@/features/calls/components/ChannelCallIndicator";
import { useChannelPrefetch } from "@/features/chat/hooks/useChannelPrefetch";

interface ChannelListItemProps {
  channel: ChatChannel;
  isActive: boolean;
  unreadCount?: number;
  mentionCount?: number;
  isMuted?: boolean;
  hasDraft?: boolean;
  /** Stable across renders (memo boundary); receives the channel id. */
  onSelect: (channelId: string) => void;
}

// Memoized: the sidebar re-renders on every message org-wide (activity sort),
// so unchanged rows must bail out on reference-equal props.
export const ChannelListItem = memo(function ChannelListItem({
  channel,
  isActive,
  unreadCount = 0,
  mentionCount = 0,
  isMuted = false,
  hasDraft = false,
  onSelect,
}: ChannelListItemProps) {
  const prefetch = useChannelPrefetch(channel.id, isActive);
  const isPrivate = channel.channelType === "PRIVATE";
  const hasUnread = unreadCount > 0;
  const Icon = isPrivate ? Lock : Hash;

  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY });
  }, []);

  const handleClick = useCallback(() => onSelect(channel.id), [onSelect, channel.id]);

  return (
    <>
      <button
        {...prefetch}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
        className={cn(
          "flex items-center gap-2 w-full px-3 py-1.5 rounded-md mx-1.5 cursor-pointer transition-colors text-left",
          "max-w-[calc(100%-12px)]",
          isActive
            ? "bg-muted text-foreground font-medium"
            : isMuted
              ? "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
              : hasUnread
                ? "font-semibold text-foreground hover:bg-muted/60"
                : "text-foreground/90 hover:bg-muted/60 hover:text-foreground",
        )}
        data-testid={`chat-sidebar-channel-${channel.id}`}
        data-channel-type={isPrivate ? "private" : "public"}
        data-active={isActive ? "true" : "false"}
        data-muted={isMuted ? "true" : "false"}
        data-unread={hasUnread ? "true" : "false"}
      >
        <Icon
          size={isPrivate ? 12 : 14}
          className={cn("shrink-0", isActive ? "text-primary" : "text-muted-foreground")}
        />

        <span
          className="truncate text-[0.9rem] font-[450] flex-1"
          data-testid={`chat-sidebar-channel-name-${channel.id}`}
        >
          {channel.name}
        </span>

        <ChannelCallIndicator channelId={channel.id} />

        {isMuted && <SpeakerSlash size={12} className="shrink-0 text-subtle-foreground" />}

        {hasDraft && mentionCount === 0 && (
          <PencilSimple
            size={12}
            className="shrink-0 text-muted-foreground"
            data-testid={`chat-sidebar-channel-draft-${channel.id}`}
          />
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
});
