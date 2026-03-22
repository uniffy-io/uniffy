/**
 * ChannelContextMenu - Right-click context menu for channel list items.
 *
 * Provides actions like opening a channel in split view and muting.
 * Renders as a fixed-position menu at the cursor location.
 */

import { useEffect, useRef, useCallback } from 'react';
import { SquareSplitHorizontal, SpeakerSlash } from '@phosphor-icons/react';
import { useAppDispatch } from '@/app/hooks';
import { setSplitChannel } from '@/features/chat/store/chatChannelsSlice';
import { activateSplit } from '@/features/chat/store/chatUiSlice';

interface ChannelContextMenuProps {
  channelId: string;
  position: { x: number; y: number };
  onClose: () => void;
}

export function ChannelContextMenu({ channelId, position, onClose }: ChannelContextMenuProps) {
  const dispatch = useAppDispatch();
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on click outside
  useEffect(() => {
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
  }, [onClose]);

  // Close on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const handleOpenInSplit = useCallback(() => {
    dispatch(setSplitChannel(channelId));
    dispatch(activateSplit());
    onClose();
  }, [dispatch, channelId, onClose]);

  const handleMute = useCallback(() => {
    // Placeholder - mute functionality not yet implemented
    onClose();
  }, [onClose]);

  // Adjust position to keep menu on screen
  const menuStyle = {
    top: position.y,
    left: position.x,
  };

  return (
    <div
      ref={menuRef}
      className="fixed z-50 bg-card border border-border rounded-lg shadow-xl py-1 min-w-[180px]"
      style={menuStyle}
    >
      <button
        type="button"
        onClick={handleOpenInSplit}
        className="flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-muted cursor-pointer w-full text-left transition-colors text-foreground"
      >
        <SquareSplitHorizontal size={16} className="text-muted-foreground" />
        <span>Open in Split View</span>
      </button>

      <div className="my-1 h-px bg-border mx-2" />

      <button
        type="button"
        onClick={handleMute}
        className="flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-muted cursor-pointer w-full text-left transition-colors text-foreground"
      >
        <SpeakerSlash size={16} className="text-muted-foreground" />
        <span>Mute channel</span>
      </button>
    </div>
  );
}
