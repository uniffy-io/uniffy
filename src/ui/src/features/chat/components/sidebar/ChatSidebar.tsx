/**
 * ChatSidebar - Left sidebar with channels organized by categories, DMs, and threads.
 *
 * Structure:
 * - Header: action buttons + collapse toggle
 * - Search input: filters channel list
 * - Threads link with unread badge
 * - Channel categories (collapsible, each containing channels sorted by activity)
 * - Direct Messages section (collapsible, sorted by activity)
 */

import { useState, useCallback, useMemo, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Plus,
  GearSix,
  PencilSimple,
  MagnifyingGlass,
  ChatsCircle,
  Tray,
  CaretDown,
  CaretRight,
  CaretDoubleLeft,
  CaretDoubleRight,
} from '@phosphor-icons/react';
import { useAppSelector, useAppDispatch } from '@/app/hooks';
import { useBreakpoint } from '@/shared/hooks/useBreakpoint';
import { Input } from '@/components/ui/input';
import { SidebarOverlayContext } from '@/components/layout/CollapsibleSidebarRail';
import { setActiveChannel, setSplitChannel } from '@/features/chat/store/chatChannelsSlice';
import {
  toggleDmSection,
  collapseSidebar,
  expandSidebar,
  selectSplitActive,
  selectFocusedPane,
} from '@/features/chat/store/chatUiSlice';
import { MOCK_CATEGORIES } from '@/features/chat/mock/mockChannels';
import { ChannelListItem } from '@/features/chat/components/sidebar/ChannelListItem';
import { DirectMessageListItem } from '@/features/chat/components/sidebar/DirectMessageListItem';
import { CategorySection } from '@/features/chat/components/sidebar/CategorySection';

export function ChatSidebar() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');
  const { isMobile } = useBreakpoint();
  const isOverlay = useContext(SidebarOverlayContext);

  const channels = useAppSelector((state) => state.chatChannels.channels);
  const activeChannelId = useAppSelector((state) => state.chatChannels.activeChannelId);
  const dmSectionCollapsed = useAppSelector((state) => state.chatUi.dmSectionCollapsed);
  const splitActive = useAppSelector(selectSplitActive);
  const focusedPane = useAppSelector(selectFocusedPane);
  const unreadThreadCount = useAppSelector((state) =>
    state.chatThreads.threadsInbox.filter(t => t.hasUnread).length
  );

  // Mock unread counts per channel (will come from read cursors in production)
  const unreadCounts: Record<string, number> = useMemo(() => ({
    'ch-001': 3,
    'ch-002': 7,
    'ch-005': 1,
    'ch-007': 2,
    'ch-009': 4,
  }), []);

  const totalUnread = useMemo(
    () => Object.values(unreadCounts).reduce((sum, n) => sum + n, 0),
    [unreadCounts],
  );

  // Filter channels by search query
  const filteredChannels = useMemo(() => {
    const query = searchQuery.toLowerCase();
    return channels.filter(c => !query || c.name.toLowerCase().includes(query));
  }, [channels, searchQuery]);

  // Split into non-DM channels (for categories) and DMs
  const nonDmChannels = useMemo(
    () => filteredChannels
      .filter(c => c.channelType !== 'DIRECT' && c.channelType !== 'GROUP_DM')
      .sort((a, b) => (b.lastRootMessageAt ?? '').localeCompare(a.lastRootMessageAt ?? '')),
    [filteredChannels],
  );

  const directMessages = useMemo(
    () => filteredChannels
      .filter(c => c.channelType === 'DIRECT' || c.channelType === 'GROUP_DM')
      .sort((a, b) => (b.lastMessageAt ?? '').localeCompare(a.lastMessageAt ?? '')),
    [filteredChannels],
  );

  // Group channels by category
  const categorizedChannels = useMemo(() => {
    const sortedCategories = [...MOCK_CATEGORIES].sort((a, b) => a.position - b.position);

    const groups: { categoryId: string | null; categoryName: string; channels: typeof nonDmChannels }[] = [];

    for (const cat of sortedCategories) {
      const catChannels = nonDmChannels.filter(c => c.categoryId === cat.id);
      if (catChannels.length > 0 || !searchQuery) {
        groups.push({
          categoryId: cat.id,
          categoryName: cat.name,
          channels: catChannels,
        });
      }
    }

    // Uncategorized channels
    const uncategorized = nonDmChannels.filter(c => !c.categoryId);
    if (uncategorized.length > 0) {
      groups.push({
        categoryId: null,
        categoryName: 'Channels',
        channels: uncategorized,
      });
    }

    return groups;
  }, [nonDmChannels, searchQuery]);

  const handleChannelSelect = useCallback((channelId: string) => {
    if (splitActive) {
      // In split mode, replace the focused pane's channel
      if (focusedPane === 'left') {
        dispatch(setActiveChannel(channelId));
      } else {
        dispatch(setSplitChannel(channelId));
      }
    } else {
      dispatch(setActiveChannel(channelId));
    }
    navigate(`/chat/${channelId}`);
  }, [dispatch, navigate, splitActive, focusedPane]);

  const handleThreadsClick = useCallback(() => {
    navigate('/chat/threads');
  }, [navigate]);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center px-3 pt-3 pb-2 gap-0.5">
        <button
          className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          title="New message"
        >
          <PencilSimple size={16} />
        </button>
        <button
          className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          title="Chat notifications"
        >
          <GearSix size={16} />
        </button>
        <div className="flex-1" />
        {!isMobile && (
          <button
            onClick={() => dispatch(isOverlay ? expandSidebar() : collapseSidebar())}
            className="p-1.5 rounded-md bg-transparent hover:bg-muted transition-colors shrink-0"
            title={isOverlay ? 'Pin sidebar' : 'Collapse sidebar'}
          >
            {isOverlay
              ? <CaretDoubleRight size={16} weight="bold" className="text-primary" />
              : <CaretDoubleLeft size={16} weight="bold" className="text-primary" />
            }
          </button>
        )}
      </div>

      {/* Search */}
      <div className="px-3 py-2">
        <div className="relative">
          <MagnifyingGlass
            size={14}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="text"
            placeholder="Search channels..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-7 pl-8 text-xs bg-muted/50"
          />
        </div>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto">
        {/* Threads link */}
        <button
          onClick={handleThreadsClick}
          className="flex items-center justify-between w-full px-3 py-1.5 mx-0 text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
        >
          <span className="flex items-center gap-2">
            <ChatsCircle size={16} />
            <span className="font-medium">Threads</span>
          </span>
          {unreadThreadCount > 0 && (
            <span className="min-w-[18px] h-[18px] rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center">
              {unreadThreadCount}
            </span>
          )}
        </button>

        {/* Unreads link */}
        <button
          onClick={() => navigate('/chat/unreads')}
          className="flex items-center justify-between w-full px-3 py-1.5 mx-0 text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
        >
          <span className="flex items-center gap-2">
            <Tray size={16} />
            <span className="font-medium">Unreads</span>
          </span>
          {totalUnread > 0 && (
            <span className="min-w-[18px] h-[18px] rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center">
              {totalUnread}
            </span>
          )}
        </button>

        {/* Channel categories */}
        {categorizedChannels.map(group => (
          <CategorySection
            key={group.categoryId ?? 'uncategorized'}
            name={group.categoryName}
            onAddChannel={() => { /* TODO: open create channel modal */ }}
          >
            {group.channels.map(channel => (
              <ChannelListItem
                key={channel.id}
                channel={channel}
                isActive={channel.id === activeChannelId}
                unreadCount={unreadCounts[channel.id] ?? 0}
                onClick={() => handleChannelSelect(channel.id)}
              />
            ))}
          </CategorySection>
        ))}

        {/* Direct Messages section */}
        <div className="mt-1">
          <button
            onClick={() => dispatch(toggleDmSection())}
            className="flex items-center justify-between w-full px-3 py-1.5 group"
          >
            <span className="flex items-center gap-1 text-xs uppercase font-medium tracking-wider text-muted-foreground">
              {dmSectionCollapsed ? <CaretRight size={10} /> : <CaretDown size={10} />}
              Direct Messages
            </span>
            <Plus
              size={14}
              className="text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity hover:text-foreground"
              onClick={(e) => {
                e.stopPropagation();
                // TODO: open new DM modal
              }}
            />
          </button>

          {!dmSectionCollapsed && (
            <div className="space-y-px">
              {directMessages.map(channel => (
                <DirectMessageListItem
                  key={channel.id}
                  channel={channel}
                  isActive={channel.id === activeChannelId}
                  unreadCount={unreadCounts[channel.id] ?? 0}
                  onClick={() => handleChannelSelect(channel.id)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
