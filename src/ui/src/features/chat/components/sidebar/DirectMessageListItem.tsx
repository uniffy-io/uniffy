/**
 * DirectMessageListItem - DM row in the sidebar.
 *
 * Shows user avatar with presence, name, muted indicator, and unread badge.
 * For group DMs, shows participant count.
 * Supports right-click context menu for split view and notification settings.
 */

import { useState, useCallback, useMemo } from 'react';
import { SpeakerSlash, PencilSimple } from '@phosphor-icons/react';
import { cn } from '@/shared/utils/cn';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { type ChatChannel } from '@/features/chat/types';
import { getChannelDisplayName } from '@/features/chat/utils/channelDisplay';
import { openRenameAgentChatDialog } from '@/features/chat/store/chatUiSlice';
import { SubjectAvatar, SubjectAvatarById } from '@/components/subject';
import { SUBJECT_TYPE, type Subject } from '@/components/subject/types';
import { AgentAvatar } from '@/features/agents/components/AgentAvatar';
import { ChannelContextMenu } from '@/features/chat/components/sidebar/ChannelContextMenu';
import { CustomStatusDisplay } from '@/features/presence/components/CustomStatusDisplay';

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
  const isAgentDm = channel.isAgentDm;
  const currentUserName = useAppSelector((s) => s.auth.user?.fullName ?? '');
  const currentUserId = useAppSelector((s) => s.auth.user?.id ?? '');

  const displayName = useMemo(() => {
    if (isAgentDm) {
      return getChannelDisplayName(channel);
    }
    if (!currentUserName) return channel.name;
    const parts = channel.name.split(', ').filter((n) => n !== currentUserName);
    return parts.length > 0 ? parts.join(', ') : channel.name;
  }, [channel, currentUserName, isAgentDm]);

  const otherUserId = useMemo(() => {
    if (isGroupDm) return '';
    if (isAgentDm) return channel.agentId ?? '';
    const peer = (channel.dmMemberIds ?? []).find(
      (id) => !!id && id !== currentUserId,
    );
    if (peer) return peer;
    if (channel.ownerId && channel.ownerId !== currentUserId) {
      return channel.ownerId;
    }
    return '';
  }, [channel.dmMemberIds, channel.ownerId, channel.agentId, currentUserId, isGroupDm, isAgentDm]);

  const agent = useAppSelector((state) =>
    isAgentDm && channel.agentId ? state.agents.agents[channel.agentId] ?? null : null,
  );

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

  const dispatch = useAppDispatch();
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY });
  }, []);

  const handleRenameClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      dispatch(openRenameAgentChatDialog(channel.id));
    },
    [dispatch, channel.id],
  );

  return (
    <>
      <div
        className={cn(
          'group/dm relative flex items-center rounded-md mx-1.5 transition-colors',
          'max-w-[calc(100%-12px)]',
          isActive
            ? 'bg-primary/10 text-primary'
            : isMuted
              ? 'text-muted-foreground/60 hover:bg-accent hover:text-muted-foreground'
              : hasUnread
                ? 'font-semibold text-foreground hover:bg-accent'
                : 'text-foreground/90 hover:bg-accent hover:text-foreground',
        )}
        data-testid={`chat-sidebar-dm-${channel.id}`}
        data-dm-kind={isGroupDm ? 'group' : isAgentDm ? 'agent' : 'user'}
        data-active={isActive ? 'true' : 'false'}
        data-muted={isMuted ? 'true' : 'false'}
        data-unread={hasUnread ? 'true' : 'false'}
      >
        <button
          type="button"
          onClick={onClick}
          onContextMenu={handleContextMenu}
          className={cn(
            'flex items-center gap-2 flex-1 min-w-0 px-3 py-1.5 cursor-pointer text-left bg-transparent',
            isActive ? 'font-medium' : '',
          )}
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
            {displayName}
          </span>

          {!isGroupDm && !isAgentDm && otherUserId && (
            <CustomStatusDisplay
              userId={otherUserId}
              className="text-sm"
              compact
            />
          )}

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

        {isAgentDm && (
          <button
            type="button"
            onClick={handleRenameClick}
            aria-label="Rename chat"
            title="Rename chat"
            className={cn(
              'absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded',
              'text-muted-foreground hover:text-foreground hover:bg-foreground/10 transition-opacity',
              'opacity-0 group-hover/dm:opacity-100 focus:opacity-100',
              'md:opacity-0 md:group-hover/dm:opacity-100',
            )}
            data-testid={`chat-sidebar-dm-rename-${channel.id}`}
          >
            <PencilSimple size={12} weight="regular" />
          </button>
        )}
      </div>

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
