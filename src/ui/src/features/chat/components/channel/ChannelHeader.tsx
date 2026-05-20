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
  CaretDown,
  CaretUp,
  SquareSplitHorizontal,
  SidebarSimple,
  X,
  LinkSimple,
  Gauge,
} from '@phosphor-icons/react';
import { useAppSelector, useAppDispatch } from '@/app/hooks';
import { useTagsByIds } from '@/features/tags/store/selectors';
import {
  selectActiveChannel,
} from '@/features/chat/store/chatChannelsSlice';
import {
  toggleChannelHeaderExpanded,
  selectChannelHeaderExpanded,
  selectSplitActive,
  deactivateSplit,
  expandSidebar,
  selectSidebarOpen,
} from '@/features/chat/store/chatUiSlice';
import { ChatSearchPanel } from '@/features/chat/components/search/ChatSearchPanel';
import {
  setSplitChannel,
  clearSplitChannel,
} from '@/features/chat/store/chatChannelsSlice';
import { activateSplit, openChannelSettingsModal } from '@/features/chat/store/chatUiSlice';
import { openResourcePanel, selectResourcePanelOpen } from '@/features/chat/store/chatUiSlice';
import { AgentAvatar } from '@/features/agents/components/AgentAvatar';
import { AgentContextBar } from '@/features/chat/components/channel/AgentContextBar';
import { ChannelAgentsPopover } from '@/features/chat/components/channel/ChannelAgentsPopover';
import { CustomStatusDisplay } from '@/features/presence/components/CustomStatusDisplay';
import { cn } from '@/shared/utils/cn';
import { formatDateFull } from '@/shared/utils/dateFormatting';
import { useBreakpoint } from '@/shared/hooks/useBreakpoint';
import { SplitChannelPicker } from '@/features/chat/components/channel/SplitChannelPicker';
import { PinnedMessagesPanel } from '@/features/chat/components/channel/PinnedMessagesPanel';
import { selectPinnedCountForChannel } from '@/features/chat/store/chatMessagesSlice';
import { jumpToMessage } from '@/features/chat/store/chatUiSlice';
import { Input } from '@/components/ui/input';
import { renameAgentChat } from '@/features/chat/store/chatThunks';
import { getChannelDisplayName } from '@/features/chat/utils/channelDisplay';
import { TagChip } from '@/features/tags';

const headerButtonClass = cn(
  'group/btn relative flex items-center justify-center h-7 w-7 rounded-md',
  'border border-foreground/15 bg-transparent text-muted-foreground',
  'transition-all duration-300 ease-out',
  'hover:border-foreground/30 hover:bg-muted hover:text-primary',
);

const headerButtonActiveClass =
  'text-primary bg-primary/10 border-primary/50 hover:border-primary/50 hover:bg-primary/10';

const headerChipClass = cn(
  'group/btn flex items-center gap-1 h-7 px-1.5 rounded-md',
  'border border-foreground/15 bg-transparent text-xs text-muted-foreground',
  'transition-all duration-300 ease-out',
  'hover:border-foreground/30 hover:bg-muted hover:text-primary',
);

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
  const splitActive = useAppSelector(selectSplitActive);
  const sidebarOpen = useAppSelector(selectSidebarOpen);
  const { isMobile, isMobileOrTablet } = useBreakpoint();

  const resourcePanelOpen = useAppSelector(selectResourcePanelOpen);
  const [showPicker, setShowPicker] = useState(false);
  const [showPinned, setShowPinned] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [showContextBar, setShowContextBar] = useState(false);
  const [showAgentsPopover, setShowAgentsPopover] = useState(false);
  const splitBtnRef = useRef<HTMLButtonElement>(null);
  const pinnedBtnRef = useRef<HTMLButtonElement>(null);
  const searchBtnRef = useRef<HTMLButtonElement>(null);
  const contextBtnRef = useRef<HTMLButtonElement>(null);

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
  const currentUserId = useAppSelector((s) => s.auth.user?.id ?? '');
  const pinnedCount = useAppSelector((state) =>
    activeChannel ? selectPinnedCountForChannel(state, activeChannel.id) : 0,
  );

  const isDm = activeChannel?.channelType === 'DIRECT' || activeChannel?.channelType === 'GROUP_DM';
  const isOneOnOneDm = activeChannel?.channelType === 'DIRECT';
  const isAgentDm = !!activeChannel?.isAgentDm;

  const dmPeerUserId = useMemo(() => {
    if (!activeChannel || !isOneOnOneDm || isAgentDm) return '';
    const peer = (activeChannel.dmMemberIds ?? []).find(
      (id) => !!id && id !== currentUserId,
    );
    if (peer) return peer;
    if (activeChannel.ownerId && activeChannel.ownerId !== currentUserId) {
      return activeChannel.ownerId;
    }
    return '';
  }, [activeChannel, isOneOnOneDm, isAgentDm, currentUserId]);

  const agent = useAppSelector((state) =>
    isAgentDm && activeChannel?.agentId
      ? state.agents.agents[activeChannel.agentId] ?? null
      : null,
  );

  // Show the Gauge icon on every non-(1:1-DM) channel regardless of whether
  // we have already fetched its member roster. Conditioning on
  // `hasAgentMembers` made the button flicker between renders while the
  // members slice was loading; the popover handles the empty state itself.
  const isGroupChannel = !isOneOnOneDm;

  const headerName = useMemo(() => {
    if (!activeChannel) return '';
    if (isAgentDm) return getChannelDisplayName(activeChannel);
    if (!isDm || !currentUserName) return activeChannel.name;
    const parts = activeChannel.name.split(', ').filter((n) => n !== currentUserName);
    return parts.length > 0 ? parts.join(', ') : activeChannel.name;
  }, [isDm, isAgentDm, activeChannel, currentUserName]);

  const [isEditingName, setIsEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [isSavingName, setIsSavingName] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isEditingName) return;
    const timer = setTimeout(() => nameInputRef.current?.focus(), 30);
    return () => clearTimeout(timer);
  }, [isEditingName]);

  const handleNameClick = useCallback(() => {
    if (!activeChannel) return;
    if (isAgentDm) {
      setNameDraft(activeChannel.customName ?? '');
      setIsEditingName(true);
      return;
    }
    dispatch(toggleChannelHeaderExpanded());
  }, [activeChannel, isAgentDm, dispatch]);

  const submitNameDraft = useCallback(async () => {
    if (!activeChannel || !isAgentDm) {
      setIsEditingName(false);
      return;
    }
    const trimmed = nameDraft.trim();
    const next = trimmed.length === 0 ? null : trimmed;
    const current = activeChannel.customName ?? null;
    if (next === current) {
      setIsEditingName(false);
      return;
    }
    setIsSavingName(true);
    try {
      await dispatch(
        renameAgentChat({ channelId: activeChannel.id, customName: next }),
      ).unwrap();
    } finally {
      setIsSavingName(false);
      setIsEditingName(false);
    }
  }, [activeChannel, isAgentDm, nameDraft, dispatch]);

  const handleNameKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        void submitNameDraft();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setIsEditingName(false);
      }
    },
    [submitNameDraft],
  );

  const channelTags = useTagsByIds(activeChannel?.tagIds ?? []);

  if (!activeChannel) return null;

  const isPrivate = activeChannel.channelType === 'PRIVATE';
  const ChannelIcon = isPrivate ? Lock : Hash;
  const createdDate = formatDateFull(activeChannel.createdAt);
  const currentChannelId = activeChannel.id;

  return (
    <div
      className="border-b border-border/60 bg-card"
      data-testid="chat-channel-header"
      data-channel-id={activeChannel.id}
      data-channel-type={activeChannel.channelType}
    >
      {/* Compact header row */}
      <div className="flex items-center gap-3 px-4 py-2">
        {/* Mobile sidebar toggle - opens chat nav drawer */}
        {isMobile && !sidebarOpen && !showCloseButton && (
          <button
            type="button"
            onClick={() => dispatch(expandSidebar())}
            className={cn(headerButtonClass, 'shrink-0')}
            aria-label="Open chat navigation"
            data-testid="chat-channel-mobile-sidebar-toggle"
          >
            <SidebarSimple size={16} />
          </button>
        )}
        {/* Channel name + chevron (clickable to expand) */}
        {!isDm && (
          <ChannelIcon size={16} className="text-muted-foreground shrink-0" />
        )}
        {isAgentDm && (
          <AgentAvatar
            avatarKey={agent?.avatarKey}
            avatarEmoji={agent?.avatarEmoji}
            agentName={agent?.name ?? headerName}
            size="sm"
          />
        )}
        {isAgentDm && isEditingName ? (
          <Input
            ref={nameInputRef}
            type="text"
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={() => void submitNameDraft()}
            onKeyDown={handleNameKeyDown}
            disabled={isSavingName}
            placeholder={activeChannel.name}
            maxLength={201}
            className="h-7 text-sm font-semibold w-56"
            data-testid="chat-channel-name-input"
          />
        ) : (
          <button
            type="button"
            onClick={handleNameClick}
            className="flex items-center gap-1 text-sm font-semibold text-foreground cursor-pointer hover:text-foreground/80 transition-colors"
            data-testid="chat-channel-name"
            title={isAgentDm ? 'Click to rename' : undefined}
          >
            <span>{headerName}</span>
            {dmPeerUserId && (
              <CustomStatusDisplay userId={dmPeerUserId} className="text-sm" compact />
            )}
            {!isDm && (
              isExpanded ? <CaretUp size={12} /> : <CaretDown size={12} />
            )}
          </button>
        )}

        {/* Member count (hidden for 1:1 DMs) */}
        {!(activeChannel.channelType === 'DIRECT') && (
          <button
            type="button"
            onClick={() => dispatch(openChannelSettingsModal('members'))}
            className={headerChipClass}
            data-testid="chat-channel-members-button"
            title={`${activeChannel.memberCount} members`}
          >
            <Users size={14} weight="regular" />
            <span className="font-medium tabular-nums">{activeChannel.memberCount}</span>
          </button>
        )}

        {/* Spacer */}
        <div className="flex-1" />

        {/* Right action buttons */}
        <div className="flex items-center gap-1.5">
          {isAgentDm && agent && (
            <button
              type="button"
              onClick={() => setShowContextBar((prev) => !prev)}
              className={cn(headerButtonClass, showContextBar && headerButtonActiveClass)}
              aria-label={showContextBar ? 'Hide agent context' : 'Show agent context'}
              title="Agent context"
              data-testid="chat-channel-agent-context-toggle"
              data-state={showContextBar ? 'open' : 'closed'}
            >
              <Gauge size={16} />
            </button>
          )}
          {isGroupChannel && (
            <button
              ref={contextBtnRef}
              type="button"
              onClick={() => setShowAgentsPopover((prev) => !prev)}
              className={cn(headerButtonClass, showAgentsPopover && headerButtonActiveClass)}
              aria-label={showAgentsPopover ? 'Hide agent context' : 'Show agent context'}
              title="Agent context"
              data-testid="chat-channel-agents-toggle"
              data-state={showAgentsPopover ? 'open' : 'closed'}
            >
              <Gauge size={16} />
            </button>
          )}
          {showAgentsPopover && activeChannel && (
            <ChannelAgentsPopover
              channelId={activeChannel.id}
              anchorRef={contextBtnRef}
              onClose={() => setShowAgentsPopover(false)}
            />
          )}

          <button
            ref={searchBtnRef}
            type="button"
            onClick={() => setShowSearch(prev => !prev)}
            className={cn(headerButtonClass, showSearch && headerButtonActiveClass)}
            aria-label="Search messages"
            data-testid="chat-channel-search-button"
            data-state={showSearch ? 'open' : 'closed'}
          >
            <MagnifyingGlass size={16} />
          </button>
          {showSearch && activeChannel && (
            <ChatSearchPanel
              channelId={activeChannel.id}
              channelName={getChannelDisplayName(activeChannel)}
              anchorRef={searchBtnRef}
              onClose={() => setShowSearch(false)}
            />
          )}

          <button
            ref={pinnedBtnRef}
            type="button"
            onClick={() => setShowPinned(prev => !prev)}
            className={cn(headerButtonClass, showPinned && headerButtonActiveClass)}
            aria-label="Pinned messages"
            data-testid="chat-channel-pinned-button"
            data-state={showPinned ? 'open' : 'closed'}
          >
            <PushPin size={16} />
            {pinnedCount > 0 && !showPinned && (
              <span
                className="absolute -top-0.5 -right-0.5 flex items-center justify-center w-3.5 h-3.5 rounded-full bg-primary text-primary-foreground text-[9px] font-medium leading-none"
                data-testid="chat-channel-pinned-count"
              >
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

          <button
            type="button"
            onClick={() => dispatch(openResourcePanel())}
            className={cn(headerButtonClass, resourcePanelOpen && headerButtonActiveClass)}
            aria-label="Channel resources"
            data-testid="chat-channel-resources-button"
            data-state={resourcePanelOpen ? 'open' : 'closed'}
          >
            <LinkSimple size={16} />
          </button>

          {/* Split-screen button - desktop only */}
          {!isMobileOrTablet && !showCloseButton && (
            <div className="relative">
              <button
                ref={splitBtnRef}
                type="button"
                onClick={handleSplitClick}
                className={cn(headerButtonClass, splitActive && headerButtonActiveClass)}
                aria-label={splitActive ? 'Close split view' : 'Open split view'}
                data-testid="chat-channel-split-button"
                data-state={splitActive ? 'active' : 'inactive'}
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
              data-testid="chat-channel-settings-button"
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
              data-testid="chat-channel-close-split-button"
            >
              <X size={16} />
            </button>
          )}

        </div>
      </div>

      {/* Per-(channel, agent) context bar for 1:1 agent DMs.
          Collapsed by default; toggled via the Gauge icon above. */}
      {isAgentDm && agent && showContextBar && (
        <AgentContextBar
          channelId={activeChannel.id}
          agentId={agent.id}
          agentName={agent.name}
        />
      )}

      {/* Expandable description section */}
      {!isDm && (
        <div
          className={cn(
            'overflow-hidden transition-[max-height,opacity] duration-200 ease-out',
            isExpanded ? 'max-h-48 opacity-100' : 'max-h-0 opacity-0',
          )}
        >
          <div className="px-4 py-2 border-t border-border/50 space-y-1.5">
            {activeChannel.description && (
              <p className="text-sm text-muted-foreground">
                {activeChannel.description}
              </p>
            )}
            {channelTags.length > 0 && (
              <div
                className="flex flex-wrap items-center gap-1"
                data-testid="chat-channel-header-tags"
              >
                {channelTags.map((tag) => (
                  <TagChip key={tag.id} tag={tag} className="text-[11px] px-2 py-0.5" />
                ))}
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              Created on {createdDate}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
