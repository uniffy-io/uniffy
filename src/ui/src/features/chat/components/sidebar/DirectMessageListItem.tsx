/**
 * DirectMessageListItem - DM row in the sidebar.
 *
 * Shows user avatar with presence, name, and unread badge.
 * For group DMs, shows participant count.
 * Supports right-click context menu for split view and other actions.
 */

import { useState, useCallback, useMemo } from 'react';
import { cn } from '@/shared/utils/cn';
import { useAppSelector } from '@/app/hooks';
import { type ChatChannel } from '@/features/chat/types';
import { SubjectAvatar, SubjectAvatarById } from '@/components/subject';
import { SUBJECT_TYPE, type Subject } from '@/components/subject/types';
import { ChannelContextMenu } from '@/features/chat/components/sidebar/ChannelContextMenu';

interface DirectMessageListItemProps {
  channel: ChatChannel;
  isActive: boolean;
  unreadCount?: number;
  onClick: () => void;
}

export function DirectMessageListItem({
  channel,
  isActive,
  unreadCount = 0,
  onClick,
}: DirectMessageListItemProps) {
  const hasUnread = unreadCount > 0;
  const isGroupDm = channel.channelType === 'GROUP_DM';
  const currentUserName = useAppSelector((s) => s.auth.user?.fullName ?? '');
  const currentUserId = useAppSelector((s) => s.auth.user?.id ?? '');

  // Strip the current user's name so each user sees the other participant(s)
  const displayName = useMemo(() => {
    if (!currentUserName) return channel.name;
    const parts = channel.name.split(', ').filter((n) => n !== currentUserName);
    return parts.length > 0 ? parts.join(', ') : channel.name;
  }, [channel.name, currentUserName]);

  // For 1:1 DMs, resolve the other person's user ID for avatar/presence.
  // dmMemberIds has all participants; pick the one that isn't us.
  // Fallback to ownerId for older channels without dmMemberIds.
  const otherUserId = useMemo(() => {
    if (isGroupDm) return '';
    if (channel.dmMemberIds.length > 0) {
      return channel.dmMemberIds.find((id) => id !== currentUserId) ?? channel.ownerId;
    }
    return channel.ownerId;
  }, [channel.dmMemberIds, channel.ownerId, currentUserId, isGroupDm]);

  // Group DM subject (violet group avatar style)
  const groupSubject = useMemo<Subject | null>(() => {
    if (!isGroupDm) return null;
    // For group DMs, also strip current user from the display name
    const groupDisplayName = currentUserName
      ? channel.name.split(', ').filter((n) => n !== currentUserName).join(', ')
      : channel.name;
    return {
      id: channel.id,
      type: SUBJECT_TYPE.GROUP,
      name: groupDisplayName,
      memberCount: channel.memberCount,
    };
  }, [channel.id, channel.name, isGroupDm, currentUserName, channel.memberCount]);

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
            : hasUnread
              ? "font-semibold text-foreground hover:bg-muted"
              : "text-muted-foreground hover:bg-muted hover:text-foreground"
        )}
      >
        {/* Avatar with presence */}
        <div className="shrink-0">
          {groupSubject ? (
            <SubjectAvatar subject={groupSubject} size="sm" />
          ) : (
            <SubjectAvatarById userId={otherUserId} displayName={displayName} size="sm" showPresence />
          )}
        </div>

        <span className="truncate text-sm flex-1">
          {displayName}
        </span>

        {hasUnread && (
          <span className="min-w-[18px] h-[18px] rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center shrink-0">
            {unreadCount}
          </span>
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
