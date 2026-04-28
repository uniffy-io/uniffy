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
  PencilSimple,
  MagnifyingGlass,
  ChatsCircle,
  Tray,
  Compass,
  CaretDown,
  CaretRight,
  CaretDoubleLeft,
  CaretDoubleRight,
} from '@phosphor-icons/react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { useAppSelector, useAppDispatch } from '@/app/hooks';
import { useBreakpoint } from '@/shared/hooks/useBreakpoint';
import { Input } from '@/components/ui/input';
import { SidebarOverlayContext } from '@/components/layout/CollapsibleSidebarRail';
import { setSplitChannel, selectChannelPreferences } from '@/features/chat/store/chatChannelsSlice';
import {
  toggleDmSection,
  collapseSidebar,
  expandSidebar,
  selectSplitActive,
  selectFocusedPane,
  openCreateChannelModal,
  openCreateCategoryModal,
  openBrowseChannelsModal,
  openNewDmModal,
} from '@/features/chat/store/chatUiSlice';
import { selectCategories, setCategories } from '@/features/chat/store/chatChannelsSlice';
import { reorderCategoriesThunk } from '@/features/chat/store/chatThunks';
import { ChannelListItem } from '@/features/chat/components/sidebar/ChannelListItem';
import { DirectMessageListItem } from '@/features/chat/components/sidebar/DirectMessageListItem';
import { CategorySection } from '@/features/chat/components/sidebar/CategorySection';
import { useChatPermissions } from '@/features/chat/hooks/useChatPermissions';
import { cn } from '@/shared/utils/cn';
import type { Icon } from '@phosphor-icons/react';

/**
 * Hover-expand pill button matching the notes sidebar header style.
 * Icon shows by default; label slides in on hover.
 */
function CompactActionButton({
  icon: IconComponent,
  label,
  onClick,
  testId,
}: {
  icon: Icon;
  label: string;
  onClick: () => void;
  testId?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      data-testid={testId}
      className={cn(
        'group relative flex items-center py-1.5 px-1.5 text-sm font-medium rounded-lg',
        'overflow-hidden transition-all duration-300 ease-out hover:px-2.5',
      )}
    >
      <span className="absolute bottom-0 left-1/2 -translate-x-1/2 h-0.5 rounded-full bg-primary transition-all duration-700 ease-out w-0 opacity-0 group-hover:w-1/2 group-hover:opacity-70" />
      <span className="relative z-10 flex items-center justify-center w-7 h-7 rounded-md transition-all duration-500 ease-out text-muted-foreground group-hover:text-primary">
        <IconComponent size={18} weight="duotone" />
      </span>
      <span className="relative z-10 ml-0 max-w-0 overflow-hidden whitespace-nowrap transition-all duration-700 ease-out group-hover:ml-1.5 group-hover:max-w-24 text-muted-foreground group-hover:text-foreground">
        {label}
      </span>
    </button>
  );
}

export function ChatSidebar() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');
  const { isMobile } = useBreakpoint();
  const isOverlay = useContext(SidebarOverlayContext);

  const channels = useAppSelector((state) => state.chatChannels.channels);
  const categories = useAppSelector(selectCategories);
  const activeChannelId = useAppSelector((state) => state.chatChannels.activeChannelId);
  const dmSectionCollapsed = useAppSelector((state) => state.chatUi.dmSectionCollapsed);
  const splitActive = useAppSelector(selectSplitActive);
  const focusedPane = useAppSelector(selectFocusedPane);
  const unreadThreadCount = useAppSelector((state) =>
    state.chatThreads.threadsInbox.filter(t => t.hasUnread).length
  );
  const { canManageChat } = useChatPermissions();
  const channelPreferences = useAppSelector(selectChannelPreferences);
  const currentUserId = useAppSelector((state) => state.auth.user?.id ?? '');
  const allChannelMembers = useAppSelector((state) => state.chatChannels.channelMembers);

  const isChannelMuted = useCallback((channelId: string) => {
    if (channelPreferences[channelId]?.isMuted) return true;
    const members = allChannelMembers[channelId];
    if (members) {
      const me = members.find((m) => m.userId === currentUserId);
      if (me?.isMuted) return true;
    }
    return false;
  }, [channelPreferences, allChannelMembers, currentUserId]);

  // Unread counts from channel data (populated by API)
  const unreadCounts: Record<string, number> = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const c of channels) {
      if (c.unreadCount && c.unreadCount > 0) {
        counts[c.id] = c.unreadCount;
      }
    }
    return counts;
  }, [channels]);

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
    const sortedCategories = [...categories].sort((a, b) => a.position - b.position);

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
  }, [nonDmChannels, searchQuery, categories]);

  const handleChannelSelect = useCallback((channelId: string) => {
    if (splitActive && focusedPane === 'right') {
      dispatch(setSplitChannel(channelId));
      return;
    }
    // Navigate only - the URL effect in ChatPage handles setActiveChannel + fetchMessages
    navigate(`/chat/${channelId}`);
  }, [dispatch, navigate, splitActive, focusedPane]);

  // Category drag-and-drop reordering
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
  );

  const sortableCategoryIds = useMemo(
    () => categorizedChannels.filter(g => g.categoryId !== null).map(g => g.categoryId!),
    [categorizedChannels],
  );

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = sortableCategoryIds.indexOf(active.id as string);
    const newIndex = sortableCategoryIds.indexOf(over.id as string);
    if (oldIndex === -1 || newIndex === -1) return;

    // Optimistic reorder in store
    const reordered = [...sortableCategoryIds];
    reordered.splice(oldIndex, 1);
    reordered.splice(newIndex, 0, active.id as string);

    const updatedCategories = reordered.map((id, i) => {
      const cat = categories.find(c => c.id === id);
      return cat ? { ...cat, position: i } : null;
    }).filter(Boolean) as typeof categories;
    dispatch(setCategories(updatedCategories));

    // Persist to backend
    dispatch(reorderCategoriesThunk(reordered));
  }, [sortableCategoryIds, categories, dispatch]);

  const handleThreadsClick = useCallback(() => {
    navigate('/chat/threads');
  }, [navigate]);

  return (
    <div className="flex flex-col h-full" data-testid="chat-sidebar-root">
      {/* Header */}
      <div className="flex items-center px-3 pt-3 pb-2 gap-0.5">
        {canManageChat && (
          <>
            <CompactActionButton
              icon={PencilSimple}
              label="Channel"
              onClick={() => dispatch(openCreateChannelModal(null))}
              testId="chat-sidebar-create-channel-button"
            />
            <CompactActionButton
              icon={Plus}
              label="Category"
              onClick={() => dispatch(openCreateCategoryModal())}
              testId="chat-sidebar-create-category-button"
            />
          </>
        )}
        <div className="flex-1" />
        {!isMobile && (
          <button
            onClick={() => dispatch(isOverlay ? expandSidebar() : collapseSidebar())}
            className="p-1.5 rounded-md bg-transparent hover:bg-muted transition-colors shrink-0"
            title={isOverlay ? 'Pin sidebar' : 'Collapse sidebar'}
            data-testid="chat-sidebar-collapse-toggle"
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
            data-testid="chat-sidebar-search"
          />
        </div>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto">
        {/* Threads link */}
        <button
          onClick={handleThreadsClick}
          className="flex items-center justify-between w-full px-3 py-1.5 mx-0 text-sm text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          data-testid="chat-sidebar-threads-link"
        >
          <span className="flex items-center gap-2">
            <ChatsCircle size={16} />
            <span className="font-medium">Threads</span>
          </span>
          {unreadThreadCount > 0 && (
            <span
              className="min-w-[18px] h-[18px] rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center"
              data-testid="chat-sidebar-threads-unread-badge"
            >
              {unreadThreadCount}
            </span>
          )}
        </button>

        {/* Unreads link */}
        <button
          onClick={() => navigate('/chat/unreads')}
          className="flex items-center justify-between w-full px-3 py-1.5 mx-0 text-sm text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          data-testid="chat-sidebar-unreads-link"
        >
          <span className="flex items-center gap-2">
            <Tray size={16} />
            <span className="font-medium">Unreads</span>
          </span>
          {totalUnread > 0 && (
            <span
              className="min-w-[18px] h-[18px] rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center"
              data-testid="chat-sidebar-unreads-badge"
            >
              {totalUnread}
            </span>
          )}
        </button>

        {/* Browse channels */}
        <button
          onClick={() => dispatch(openBrowseChannelsModal())}
          className="flex items-center gap-2 w-full px-3 py-1.5 mx-0 text-sm text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          data-testid="chat-sidebar-browse-channels-button"
        >
          <Compass size={16} />
          <span className="font-medium">Browse Channels</span>
        </button>

        {/* Channel categories (drag-and-drop reorderable) */}
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={sortableCategoryIds} strategy={verticalListSortingStrategy}>
            {categorizedChannels.map(group => (
              <CategorySection
                key={group.categoryId ?? 'uncategorized'}
                id={group.categoryId}
                name={group.categoryName}
                sortable={group.categoryId !== null}
                canManage={canManageChat}
                onAddChannel={canManageChat ? () => dispatch(openCreateChannelModal(group.categoryId)) : undefined}
              >
                {group.channels.map(channel => (
                  <ChannelListItem
                    key={channel.id}
                    channel={channel}
                    isActive={channel.id === activeChannelId}
                    unreadCount={unreadCounts[channel.id] ?? 0}
                    mentionCount={channel.mentionCount ?? 0}
                    isMuted={isChannelMuted(channel.id)}
                    onClick={() => handleChannelSelect(channel.id)}
                  />
                ))}
              </CategorySection>
            ))}
          </SortableContext>
        </DndContext>

        {/* Direct Messages section */}
        <div className="mt-1" data-testid="chat-sidebar-dm-section" data-state={dmSectionCollapsed ? 'collapsed' : 'expanded'}>
          <div className="flex items-center justify-between w-full px-3 py-1.5 group">
            <button
              type="button"
              onClick={() => dispatch(toggleDmSection())}
              className="flex items-center gap-1 text-xs uppercase font-medium tracking-wider text-muted-foreground hover:text-foreground transition-colors"
              data-testid="chat-sidebar-dm-toggle"
            >
              {dmSectionCollapsed ? <CaretRight size={10} /> : <CaretDown size={10} />}
              Direct Messages
            </button>
            <button
              type="button"
              onClick={() => dispatch(openNewDmModal())}
              aria-label="New direct message"
              className="text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity hover:text-foreground"
              data-testid="chat-sidebar-new-dm-button"
            >
              <Plus size={14} />
            </button>
          </div>

          {!dmSectionCollapsed && (
            <div className="space-y-px">
              {directMessages.map(channel => (
                <DirectMessageListItem
                  key={channel.id}
                  channel={channel}
                  isActive={channel.id === activeChannelId}
                  unreadCount={unreadCounts[channel.id] ?? 0}
                  isMuted={isChannelMuted(channel.id)}
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
