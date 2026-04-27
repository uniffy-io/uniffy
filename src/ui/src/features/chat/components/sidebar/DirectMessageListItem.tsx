/**
 * DirectMessageListItem - DM row in the sidebar.
 *
 * Shows user avatar with presence, name, muted indicator, and unread badge.
 * For group DMs, shows participant count.
 * Supports right-click context menu for split view and notification settings.
 */

import { useState, useCallback, useMemo } from 'react';
import { SpeakerSlash } from '@phosphor-icons/react';
import { cn } from '@/shared/utils/cn';
import { useAppSelector } from '@/app/hooks';
import { type ChatChannel } from '@/features/chat/types';
import { SubjectAvatar, SubjectAvatarById } from '@/components/subject';
import { SUBJECT_TYPE, type Subject } from '@/components/subject/types';
import { AgentAvatar } from '@/features/agents/components/AgentAvatar';
import { ChannelContextMenu } from '@/features/chat/components/sidebar/ChannelContextMenu';

interface DirectMessageListItemProps {
  channel: ChatChannel;
  isActive: boolean;
  unreadCount?: number;
  isMuted?: boolean;
  onClick: () => void;
}

export function DirectMessageListItem({
  channel,
  isActive,
  unreadCount = 0,
  isMuted = false,
  onClick,
}: DirectMessageListItemProps) {
  const hasUnread = unreadCount > 0;
  const isGroupDm = channel.channelType === 'GROUP_DM';
  const currentUserName = useAppSelector((s) => s.auth.user?.fullName ?? '');
  const currentUserId = useAppSelector((s) => s.auth.user?.id ?? '');

  const displayName = useMemo(() => {
    if (!currentUserName) return channel.name;
    const parts = channel.name.split(', ').filter((n) => n !== currentUserName);
    return parts.length > 0 ? parts.join(', ') : channel.name;
  }, [channel.name, currentUserName]);

  const otherUserId = useMemo(() => {
    if (isGroupDm) return '';
    if (channel.dmMemberIds.length > 0) {
      return channel.dmMemberIds.find((id) => id !== currentUserId) ?? channel.ownerId;
    }
    return channel.ownerId;
  }, [channel.dmMemberIds, channel.ownerId, currentUserId, isGroupDm]);

  // `dmMemberIds` carries mixed subject ids (users + agents). If the other
  // subject is present in the agents slice, treat this DM as an agent DM.
  const agent = useAppSelector((state) =>
    otherUserId && !isGroupDm ? state.agents.agents[otherUserId] ?? null : null,
  );
  const isAgentDm = !!agent;

  const groupSubject = useMemo<Subject | null>(() => {
    if (!isGroupDm) return null;
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
            : isMuted
              ? "text-muted-foreground/60 hover:bg-accent hover:text-muted-foreground"
              : hasUnread
                ? "font-semibold text-foreground hover:bg-accent"
                : "text-foreground/90 hover:bg-accent hover:text-foreground"
        )}
        data-testid={`chat-sidebar-dm-${channel.id}`}
        data-dm-kind={isGroupDm ? 'group' : isAgentDm ? 'agent' : 'user'}
        data-active={isActive ? 'true' : 'false'}
        data-muted={isMuted ? 'true' : 'false'}
        data-unread={hasUnread ? 'true' : 'false'}
      >
        <div className="shrink-0">
          {groupSubject ? (
            <SubjectAvatar subject={groupSubject} size="sm" />
          ) : isAgentDm ? (
            <AgentAvatar
              avatarKey={agent?.avatarKey}
              avatarEmoji={agent?.avatarEmoji}
              agentName={agent?.name ?? displayName}
              size="sm"
            />
          ) : (
            <SubjectAvatarById userId={otherUserId} displayName={displayName} size="sm" showPresence />
          )}
        </div>

        <span
          className="truncate text-[0.9rem] flex-1"
          data-testid={`chat-sidebar-dm-name-${channel.id}`}
        >
          {isAgentDm ? agent?.name ?? displayName : displayName}
        </span>

        {isMuted && (
          <SpeakerSlash size={12} className="shrink-0 text-muted-foreground/50" />
        )}

        {hasUnread && !isMuted && (
          <span
            className="min-w-[18px] h-[18px] rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center shrink-0"
            data-testid={`chat-sidebar-dm-unread-badge-${channel.id}`}
          >
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
