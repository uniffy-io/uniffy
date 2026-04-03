/**
 * ChannelHeader - Channel header with compact and expandable states.
 *
 * Compact mode shows channel name, member count, and action buttons.
 * Expanded mode reveals the channel description and creator info.
 * Includes split-screen button for side-by-side channel viewing (desktop only).
 */

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import {
  Hash,
  Lock,
  Users,
  MagnifyingGlass,
  PushPin,
  GearSix,
  CaretDoubleRight,
  CaretDown,
  CaretUp,
  SquareSplitHorizontal,
  X,
} from '@phosphor-icons/react';
import { useAppSelector, useAppDispatch } from '@/app/hooks';
import {
  selectActiveChannel,
} from '@/features/chat/store/chatChannelsSlice';
import {
  toggleChannelHeaderExpanded,
  toggleSearch,
  expandSidebar,
  selectChannelHeaderExpanded,
  selectSidebarOpen,
  selectSplitActive,
  deactivateSplit,
} from '@/features/chat/store/chatUiSlice';
import {
  setSplitChannel,
  clearSplitChannel,
} from '@/features/chat/store/chatChannelsSlice';
import { activateSplit, openChannelSettingsModal } from '@/features/chat/store/chatUiSlice';
import { cn } from '@/shared/utils/cn';
import { formatDateFull } from '@/shared/utils/dateFormatting';
import { useBreakpoint } from '@/shared/hooks/useBreakpoint';
import { SplitChannelPicker } from '@/features/chat/components/channel/SplitChannelPicker';
import { PinnedMessagesPanel } from '@/features/chat/components/channel/PinnedMessagesPanel';
import { selectMessagesForChannel } from '@/features/chat/store/chatMessagesSlice';
import { jumpToMessage } from '@/features/chat/store/chatUiSlice';

const headerButtonClass =
  'p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors';

interface ChannelHeaderProps {
  channelId?: string;
  showCloseButton?: boolean;
  onClose?: () => void;
}

export function ChannelHeader({ channelId, showCloseButton, onClose }: ChannelHeaderProps) {
  const dispatch = useAppDispatch();
  const defaultActiveChannel = useAppSelector(selectActiveChannel);
  const channelFromId = useAppSelector((state) =>
    channelId ? state.chatChannels.channels.find((c) => c.id === channelId) : undefined,
  );
  const activeChannel = channelFromId ?? defaultActiveChannel;

  const isExpanded = useAppSelector(selectChannelHeaderExpanded);
  const sidebarOpen = useAppSelector(selectSidebarOpen);
  const splitActive = useAppSelector(selectSplitActive);
  const { isMobileOrTablet } = useBreakpoint();

  const [showPicker, setShowPicker] = useState(false);
  const [showPinned, setShowPinned] = useState(false);
  const splitBtnRef = useRef<HTMLButtonElement>(null);
  const pinnedBtnRef = useRef<HTMLButtonElement>(null);

  // Close picker on Escape
  useEffect(() => {
    if (!showPicker) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowPicker(false);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [showPicker]);

  const handleSplitClick = useCallback(() => {
    if (splitActive) {
      dispatch(deactivateSplit());
      dispatch(clearSplitChannel());
    } else {
      setShowPicker(true);
    }
  }, [dispatch, splitActive]);

  const handlePickerSelect = useCallback((selectedChannelId: string) => {
    dispatch(setSplitChannel(selectedChannelId));
    dispatch(activateSplit());
    setShowPicker(false);
  }, [dispatch]);

  const currentUserName = useAppSelector((s) => s.auth.user?.fullName ?? '');
  const currentChannelMessages = useAppSelector((state) =>
    activeChannel ? selectMessagesForChannel(state, activeChannel.id) : [],
  );

  const isDm = activeChannel?.channelType === 'DIRECT' || activeChannel?.channelType === 'GROUP_DM';

  // For DMs, strip the current user's name to show only the other participant(s)
  const headerName = useMemo(() => {
    if (!activeChannel || !isDm || !currentUserName) return activeChannel?.name ?? '';
    const parts = activeChannel.name.split(', ').filter((n) => n !== currentUserName);
    return parts.length > 0 ? parts.join(', ') : activeChannel.name;
  }, [isDm, activeChannel, currentUserName]);

  if (!activeChannel) return null;

  const isPrivate = activeChannel.channelType === 'PRIVATE';
  const ChannelIcon = isPrivate ? Lock : Hash;
  const pinnedCount = currentChannelMessages.filter(m => m.isPinned && !m.isDeleted).length;
  const createdDate = formatDateFull(activeChannel.createdAt);
  const currentChannelId = activeChannel.id;

  return (
    <div className="border-b border-border bg-card">
      {/* Compact header row */}
      <div className="flex items-center gap-3 px-4 py-2">
        {/* Channel name + chevron (clickable to expand) */}
        {!isDm && (
          <ChannelIcon size={16} className="text-muted-foreground shrink-0" />
        )}
        <button
          type="button"
          onClick={() => dispatch(toggleChannelHeaderExpanded())}
          className="flex items-center gap-1 text-sm font-semibold text-foreground cursor-pointer hover:text-foreground/80 transition-colors"
        >
          <span>{headerName}</span>
          {!isDm && (
            isExpanded ? <CaretUp size={12} /> : <CaretDown size={12} />
          )}
        </button>

        {/* Member count (hidden for 1:1 DMs) */}
        {!(activeChannel.channelType === 'DIRECT') && (
          <button
            type="button"
            onClick={() => dispatch(openChannelSettingsModal('members'))}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <Users size={14} />
            <span>{activeChannel.memberCount} members</span>
          </button>
        )}

        {/* Spacer */}
        <div className="flex-1" />

        {/* Right action buttons */}
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => dispatch(toggleSearch())}
            className={headerButtonClass}
            aria-label="Search messages"
          >
            <MagnifyingGlass size={16} />
          </button>

          <button
            ref={pinnedBtnRef}
            type="button"
            onClick={() => setShowPinned(prev => !prev)}
            className={cn(headerButtonClass, 'relative', showPinned && 'text-primary bg-primary/10')}
            aria-label="Pinned messages"
          >
            <PushPin size={16} />
            {pinnedCount > 0 && !showPinned && (
              <span className="absolute -top-0.5 -right-0.5 flex items-center justify-center w-3.5 h-3.5 rounded-full bg-primary text-primary-foreground text-[9px] font-medium leading-none">
                {pinnedCount}
              </span>
            )}
          </button>
          {showPinned && activeChannel && (
            <PinnedMessagesPanel
              channelId={activeChannel.id}
              anchorRef={pinnedBtnRef}
              onClose={() => setShowPinned(false)}
              onJumpToMessage={(messageId) => dispatch(jumpToMessage(messageId))}
            />
          )}

          {/* Split-screen button - desktop only */}
          {!isMobileOrTablet && !showCloseButton && (
            <div className="relative">
              <button
                ref={splitBtnRef}
                type="button"
                onClick={handleSplitClick}
                className={cn(
                  headerButtonClass,
                  splitActive && 'text-primary bg-primary/10',
                )}
                aria-label={splitActive ? 'Close split view' : 'Open split view'}
              >
                <SquareSplitHorizontal size={16} />
              </button>

              {showPicker && (
                <SplitChannelPicker
                  onSelect={handlePickerSelect}
                  onClose={() => setShowPicker(false)}
                  currentChannelId={currentChannelId}
                />
              )}
            </div>
          )}

          {activeChannel.channelType !== 'DIRECT' && activeChannel.channelType !== 'GROUP_DM' && (
            <button
              type="button"
              onClick={() => dispatch(openChannelSettingsModal('overview'))}
              className={headerButtonClass}
              aria-label="Channel settings"
            >
              <GearSix size={16} />
            </button>
          )}

          {/* Close button for split pane */}
          {showCloseButton && onClose && (
            <button
              type="button"
              onClick={onClose}
              className={headerButtonClass}
              aria-label="Close split pane"
            >
              <X size={16} />
            </button>
          )}

          {/* Show sidebar expand button when sidebar is collapsed */}
          {!sidebarOpen && (
            <button
              type="button"
              onClick={() => dispatch(expandSidebar())}
              className="p-1.5 rounded-md bg-transparent hover:bg-muted transition-colors shrink-0"
              aria-label="Expand sidebar"
            >
              <CaretDoubleRight size={16} weight="bold" className="text-primary" />
            </button>
          )}
        </div>
      </div>

      {/* Expandable description section */}
      {!isDm && (
        <div
          className={cn(
            'overflow-hidden transition-[max-height,opacity] duration-200 ease-out',
            isExpanded ? 'max-h-32 opacity-100' : 'max-h-0 opacity-0',
          )}
        >
          <div className="px-4 py-2 border-t border-border/50">
            {activeChannel.description && (
              <p className="text-sm text-muted-foreground">
                {activeChannel.description}
              </p>
            )}
            <p className="text-xs text-muted-foreground mt-1">
              Created on {createdDate}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
