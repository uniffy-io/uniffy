/**
 * ChannelContextMenu - Right-click context menu for channel list items.
 *
 * Provides actions like opening a channel in split view and granular
 * notification settings (mute duration, notification level, thread follow).
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { SquareSplitHorizontal, SpeakerSlash, SpeakerHigh, CaretRight, PencilSimple, Trash } from '@phosphor-icons/react';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { setSplitChannel, selectChannelById, selectActiveChannelId } from '@/features/chat/store/chatChannelsSlice';
import { activateSplit, openRenameAgentChatDialog } from '@/features/chat/store/chatUiSlice';
import { selectChannelPreferences } from '@/features/chat/store/chatChannelsSlice';
import { deleteChannel } from '@/features/chat/store/chatThunks';
import { ChannelNotificationMenu } from '@/features/chat/components/sidebar/ChannelNotificationMenu';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { getChannelDisplayName } from '@/features/chat/utils/channelDisplay';

interface ChannelContextMenuProps {
  channelId: string;
  position: { x: number; y: number };
  onClose: () => void;
}

export function ChannelContextMenu({ channelId, position, onClose }: ChannelContextMenuProps) {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const menuRef = useRef<HTMLDivElement>(null);
  const currentUserId = useAppSelector((state) => state.auth.user?.id ?? '');
  const prefs = useAppSelector(selectChannelPreferences);
  const members = useAppSelector((state) => state.chatChannels.channelMembers[channelId]);
  const memberMuted = members?.find((m) => m.userId === currentUserId)?.isMuted ?? false;
  const isMuted = prefs[channelId]?.isMuted ?? memberMuted;
  const channel = useAppSelector((state) => selectChannelById(state, channelId));
  const activeChannelId = useAppSelector(selectActiveChannelId);
  const isAgentDm = !!channel?.isAgentDm;
  const [showNotificationMenu, setShowNotificationMenu] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleRename = useCallback(() => {
    dispatch(openRenameAgentChatDialog(channelId));
    onClose();
  }, [dispatch, channelId, onClose]);

  const handleDeleteClick = useCallback(() => {
    setConfirmDeleteOpen(true);
  }, []);

  const handleConfirmDelete = useCallback(async () => {
    setIsDeleting(true);
    try {
      await dispatch(deleteChannel(channelId)).unwrap();
      if (activeChannelId === channelId) {
        navigate('/chat');
      }
      setConfirmDeleteOpen(false);
      onClose();
    } finally {
      setIsDeleting(false);
    }
  }, [dispatch, channelId, activeChannelId, navigate, onClose]);

  useEffect(() => {
    if (confirmDeleteOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClick);
    }, 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClick);
    };
  }, [onClose, confirmDeleteOpen]);

  useEffect(() => {
    if (confirmDeleteOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose, confirmDeleteOpen]);

  const handleOpenInSplit = useCallback(() => {
    dispatch(setSplitChannel(channelId));
    dispatch(activateSplit());
    onClose();
  }, [dispatch, channelId, onClose]);

  const menuStyle = {
    top: position.y,
    left: position.x,
  };

  const MuteIcon = isMuted ? SpeakerHigh : SpeakerSlash;
  const btnClass = "flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-accent cursor-pointer w-full text-left transition-colors text-foreground";

  const channelName = channel ? getChannelDisplayName(channel) : 'this chat';

  return (
    <>
    <div
      ref={menuRef}
      className="fixed z-50 bg-card border border-border rounded-lg shadow-xl py-1 min-w-[180px]"
      style={menuStyle}
    >
      <button
        type="button"
        onClick={handleOpenInSplit}
        className={btnClass}
      >
        <SquareSplitHorizontal size={16} className="text-muted-foreground" />
        <span>Open in Split View</span>
      </button>

      {isAgentDm && (
        <>
          <div className="my-1 h-px bg-border mx-2" />
          <button
            type="button"
            onClick={handleRename}
            className={btnClass}
            data-testid="chat-channel-context-menu-rename"
          >
            <PencilSimple size={16} className="text-muted-foreground" />
            <span>Rename chat</span>
          </button>
          <button
            type="button"
            onClick={handleDeleteClick}
            className="flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-accent cursor-pointer w-full text-left transition-colors text-red-500 hover:text-red-500"
            data-testid="chat-channel-context-menu-delete"
          >
            <Trash size={16} />
            <span>Delete chat</span>
          </button>
        </>
      )}

      <div className="my-1 h-px bg-border mx-2" />

      <button
        type="button"
        onClick={() => setShowNotificationMenu(!showNotificationMenu)}
        className={btnClass}
      >
        <MuteIcon size={16} className="text-muted-foreground" />
        <span className="flex-1">{isMuted ? 'Muted' : 'Notification settings'}</span>
        <CaretRight size={12} className="text-muted-foreground" />
      </button>

      {showNotificationMenu && (
        <>
          <div className="my-1 h-px bg-border mx-2" />
          <ChannelNotificationMenu channelId={channelId} onClose={onClose} />
        </>
      )}
    </div>

    <ConfirmDialog
      isOpen={confirmDeleteOpen}
      onClose={() => setConfirmDeleteOpen(false)}
      onConfirm={handleConfirmDelete}
      title="Delete chat"
      message={`Delete "${channelName}"? This permanently removes the conversation and its messages. This cannot be undone.`}
      confirmLabel="Delete"
      variant="danger"
      loading={isDeleting}
    />
    </>
  );
}
