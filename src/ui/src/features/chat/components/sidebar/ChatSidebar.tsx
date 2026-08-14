import { useState, useCallback, useEffect, useMemo, useContext, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
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
  Robot,
  FolderSimplePlus,
} from "@phosphor-icons/react";
import {
  DndContext,
  closestCenter,
  pointerWithin,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  type DragEndEvent,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { useAppSelector, useAppDispatch } from "@/app/hooks";
import { useBreakpoint } from "@/shared/hooks/useBreakpoint";
import { Input } from "@/components/ui/input";
import { SidebarOverlayContext } from "@/components/layout/CollapsibleSidebarRail";
import {
  setSplitChannel,
  selectChannelPreferences,
  selectChannels,
  selectAgentFolders,
  sortByLastActivity,
  sortByRootActivity,
} from "@/features/chat/store/chatChannelsSlice";
import { createAgentFolder, setAgentChatFolder } from "@/features/chat/store/chatThunks";
import { AgentChatFolderGroup } from "@/features/chat/components/sidebar/AgentChatFolderGroup";
import { selectChannelsWithDrafts } from "@/features/chat/store/chatDraftsSlice";
import {
  toggleDmSection,
  toggleAgentChatsSection,
  revealAgentFolder,
  openAgentChatPicker,
  collapseSidebar,
  expandSidebar,
  selectSplitActive,
  selectFocusedPane,
  openCreateChannelModal,
  openCreateCategoryModal,
  openBrowseChannelsModal,
  openNewDmModal,
} from "@/features/chat/store/chatUiSlice";
import { selectCategories, setCategories } from "@/features/chat/store/chatChannelsSlice";
import { reorderCategoriesThunk } from "@/features/chat/store/chatThunks";
import { ChannelListItem } from "@/features/chat/components/sidebar/ChannelListItem";
import { DirectMessageListItem } from "@/features/chat/components/sidebar/DirectMessageListItem";
import { CategorySection } from "@/features/chat/components/sidebar/CategorySection";
import { useChatPermissions } from "@/features/chat/hooks/useChatPermissions";
import { cn } from "@/shared/utils/cn";
import type { Icon } from "@phosphor-icons/react";

function DraggableAgentChat({ channelId, children }: { channelId: string; children: ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `agent-chat:${channelId}`,
  });
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      style={{ transform: CSS.Translate.toString(transform) }}
      className={isDragging ? "relative z-30 opacity-70" : undefined}
    >
      {children}
    </div>
  );
}

function AgentUnfiledDropZone({ children }: { children: ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: "agent-folder-root" });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "rounded-md transition-colors",
        isOver && "bg-primary/5 ring-1 ring-primary/30",
      )}
      data-testid="chat-sidebar-agent-unfiled-zone"
    >
      {children}
    </div>
  );
}

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
        "group relative flex items-center py-1.5 px-1.5 text-sm font-medium rounded-lg",
        "overflow-hidden transition-all duration-300 ease-out hover:px-2.5",
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
  const [searchQuery, setSearchQuery] = useState("");
  const { isMobile } = useBreakpoint();
  const isOverlay = useContext(SidebarOverlayContext);

  const channels = useAppSelector(selectChannels);
  const categories = useAppSelector(selectCategories);
  const activeChannelId = useAppSelector((state) => state.chatChannels.activeChannelId);
  const dmSectionCollapsed = useAppSelector((state) => state.chatUi.dmSectionCollapsed);
  const agentChatsSectionCollapsed = useAppSelector(
    (state) => state.chatUi.agentChatsSectionCollapsed,
  );
  const splitActive = useAppSelector(selectSplitActive);
  const focusedPane = useAppSelector(selectFocusedPane);
  const unreadThreadCount = useAppSelector(
    (state) => state.chatThreads.threadsInbox.filter((t) => t.hasUnread).length,
  );
  const { canManageChat } = useChatPermissions();
  const channelPreferences = useAppSelector(selectChannelPreferences);
  const draftChannels = useAppSelector(selectChannelsWithDrafts);
  const currentUserId = useAppSelector((state) => state.auth.user?.id ?? "");
  const allChannelMembers = useAppSelector((state) => state.chatChannels.channelMembers);

  const isChannelMuted = useCallback(
    (channelId: string) => {
      if (channelPreferences[channelId]?.isMuted) return true;
      const members = allChannelMembers[channelId];
      if (members) {
        const me = members.find((m) => m.userId === currentUserId);
        if (me?.isMuted) return true;
      }
      return false;
    },
    [channelPreferences, allChannelMembers, currentUserId],
  );

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

  const filteredChannels = useMemo(() => {
    const query = searchQuery.toLowerCase();
    return channels.filter((c) => !query || c.name.toLowerCase().includes(query));
  }, [channels, searchQuery]);

  const nonDmChannels = useMemo(
    () =>
      filteredChannels
        .filter((c) => c.channelType !== "DIRECT" && c.channelType !== "GROUP_DM")
        .sort(sortByRootActivity),
    [filteredChannels],
  );

  const directMessages = useMemo(
    () =>
      filteredChannels
        .filter((c) => !c.isAgentDm && (c.channelType === "DIRECT" || c.channelType === "GROUP_DM"))
        .sort(sortByLastActivity),
    [filteredChannels],
  );

  const agentChats = useMemo(
    () => filteredChannels.filter((c) => c.isAgentDm).sort(sortByLastActivity),
    [filteredChannels],
  );

  const agentFolders = useAppSelector(selectAgentFolders);
  // Nullish fallback: persisted chatUi state from before this key existed omits it.
  const collapsedAgentFolders = useAppSelector((state) => state.chatUi.collapsedAgentFolders) ?? {};
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");

  const [searchParams, setSearchParams] = useSearchParams();
  const agentFolderParam = searchParams.get("agentFolder");

  // Deep link from a search result: open the section and the folder, scroll
  // to it, then strip the param so a refresh does not re-trigger the reveal.
  useEffect(() => {
    if (!agentFolderParam) return;
    dispatch(revealAgentFolder(agentFolderParam));
    const timer = setTimeout(() => {
      document
        .querySelector(`[data-testid="chat-sidebar-agent-folder-${agentFolderParam}"]`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 100);
    setSearchParams(
      (params) => {
        params.delete("agentFolder");
        return params;
      },
      { replace: true },
    );
    return () => clearTimeout(timer);
  }, [agentFolderParam, dispatch, setSearchParams]);

  // Chats pointing at a folder this user no longer has fall back to unfiled.
  const agentChatGroups = useMemo(() => {
    const folderIds = new Set(agentFolders.map((f) => f.id));
    const byFolder = new Map<string, typeof agentChats>();
    const unfiled: typeof agentChats = [];
    for (const chat of agentChats) {
      if (chat.agentFolderId && folderIds.has(chat.agentFolderId)) {
        const bucket = byFolder.get(chat.agentFolderId);
        if (bucket) {
          bucket.push(chat);
        } else {
          byFolder.set(chat.agentFolderId, [chat]);
        }
      } else {
        unfiled.push(chat);
      }
    }
    return { byFolder, unfiled };
  }, [agentChats, agentFolders]);

  const handleCreateFolder = useCallback(async () => {
    const name = newFolderName.trim();
    setCreatingFolder(false);
    setNewFolderName("");
    if (name) {
      await dispatch(createAgentFolder(name));
    }
  }, [dispatch, newFolderName]);

  const handleAgentDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over) return;
      const activeId = String(active.id);
      if (!activeId.startsWith("agent-chat:")) return;
      const channelId = activeId.slice("agent-chat:".length);
      const overId = String(over.id);
      let folderId: string | null;
      if (overId === "agent-folder-root") {
        folderId = null;
      } else if (overId.startsWith("agent-folder:")) {
        folderId = overId.slice("agent-folder:".length);
      } else {
        return;
      }
      const current = channels.find((c) => c.id === channelId)?.agentFolderId ?? null;
      if (current === folderId) return;
      dispatch(setAgentChatFolder({ channelId, folderId }));
    },
    [dispatch, channels],
  );

  const categorizedChannels = useMemo(() => {
    const sortedCategories = [...categories].sort((a, b) => a.position - b.position);

    const groups: {
      categoryId: string | null;
      categoryName: string;
      channels: typeof nonDmChannels;
    }[] = [];

    for (const cat of sortedCategories) {
      const catChannels = nonDmChannels.filter((c) => c.categoryId === cat.id);
      if (catChannels.length > 0 || !searchQuery) {
        groups.push({
          categoryId: cat.id,
          categoryName: cat.name,
          channels: catChannels,
        });
      }
    }

    const uncategorized = nonDmChannels.filter((c) => !c.categoryId);
    if (uncategorized.length > 0) {
      groups.push({
        categoryId: null,
        categoryName: "Channels",
        channels: uncategorized,
      });
    }

    return groups;
  }, [nonDmChannels, searchQuery, categories]);

  const handleChannelSelect = useCallback(
    (channelId: string) => {
      if (splitActive && focusedPane === "right") {
        dispatch(setSplitChannel(channelId));
        return;
      }
      // ChatPage's URL effect handles setActiveChannel + fetchMessages.
      navigate(`/chat/${channelId}`);
      if (isMobile) {
        dispatch(collapseSidebar());
      }
    },
    [dispatch, navigate, splitActive, focusedPane, isMobile],
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
  );

  const sortableCategoryIds = useMemo(
    () => categorizedChannels.filter((g) => g.categoryId !== null).map((g) => g.categoryId!),
    [categorizedChannels],
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;

      const oldIndex = sortableCategoryIds.indexOf(active.id as string);
      const newIndex = sortableCategoryIds.indexOf(over.id as string);
      if (oldIndex === -1 || newIndex === -1) return;

      const reordered = [...sortableCategoryIds];
      reordered.splice(oldIndex, 1);
      reordered.splice(newIndex, 0, active.id as string);

      const updatedCategories = reordered
        .map((id, i) => {
          const cat = categories.find((c) => c.id === id);
          return cat ? { ...cat, position: i } : null;
        })
        .filter(Boolean) as typeof categories;
      dispatch(setCategories(updatedCategories));

      dispatch(reorderCategoriesThunk(reordered));
    },
    [sortableCategoryIds, categories, dispatch],
  );

  const handleThreadsClick = useCallback(() => {
    navigate("/chat/threads");
  }, [navigate]);

  return (
    <div className="flex flex-col h-full" data-testid="chat-sidebar-root">
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
            title={isOverlay ? "Pin sidebar" : "Collapse sidebar"}
            data-testid="chat-sidebar-collapse-toggle"
          >
            {isOverlay ? (
              <CaretDoubleRight size={16} weight="bold" className="text-primary" />
            ) : (
              <CaretDoubleLeft size={16} weight="bold" className="text-primary" />
            )}
          </button>
        )}
      </div>

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

      <div className="flex-1 overflow-y-auto">
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

        <button
          onClick={() => navigate("/chat/unreads")}
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

        <button
          onClick={() => dispatch(openBrowseChannelsModal())}
          className="flex items-center gap-2 w-full px-3 py-1.5 mx-0 text-sm text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          data-testid="chat-sidebar-browse-channels-button"
        >
          <Compass size={16} />
          <span className="font-medium">Browse Channels</span>
        </button>

        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={sortableCategoryIds} strategy={verticalListSortingStrategy}>
            {categorizedChannels.map((group) => (
              <CategorySection
                key={group.categoryId ?? "uncategorized"}
                id={group.categoryId}
                name={group.categoryName}
                sortable={group.categoryId !== null}
                canManage={canManageChat}
                onAddChannel={
                  canManageChat
                    ? () => dispatch(openCreateChannelModal(group.categoryId))
                    : undefined
                }
              >
                {group.channels.map((channel) => (
                  <ChannelListItem
                    key={channel.id}
                    channel={channel}
                    isActive={channel.id === activeChannelId}
                    unreadCount={unreadCounts[channel.id] ?? 0}
                    mentionCount={channel.mentionCount ?? 0}
                    isMuted={isChannelMuted(channel.id)}
                    hasDraft={draftChannels.has(channel.id)}
                    onSelect={handleChannelSelect}
                  />
                ))}
              </CategorySection>
            ))}
          </SortableContext>
        </DndContext>

        <div className="mx-3 my-2 h-px bg-border/60" role="separator" />

        <div
          className="mt-1"
          data-testid="chat-sidebar-agent-chats-section"
          data-state={agentChatsSectionCollapsed ? "collapsed" : "expanded"}
        >
          <div className="flex items-center justify-between w-full px-3 py-1.5 group">
            <button
              type="button"
              onClick={() => dispatch(toggleAgentChatsSection())}
              className="flex items-center gap-1 text-xs uppercase font-medium tracking-wider text-muted-foreground hover:text-foreground transition-colors"
              data-testid="chat-sidebar-agent-chats-toggle"
            >
              {agentChatsSectionCollapsed ? <CaretRight size={10} /> : <CaretDown size={10} />}
              Agent Chats
            </button>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => {
                  setCreatingFolder(true);
                  setNewFolderName("");
                }}
                aria-label="New folder"
                title="New folder"
                className="text-muted-foreground opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity hover:text-foreground"
                data-testid="chat-sidebar-new-agent-folder-button"
              >
                <FolderSimplePlus size={14} />
              </button>
              <button
                type="button"
                onClick={() => dispatch(openAgentChatPicker())}
                aria-label="New agent chat"
                className="text-muted-foreground opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity hover:text-foreground"
                data-testid="chat-sidebar-new-agent-chat-button"
              >
                <Plus size={14} />
              </button>
            </div>
          </div>

          {creatingFolder && (
            <div className="px-3 pb-1 mx-1.5 max-w-[calc(100%-12px)]">
              <input
                autoFocus
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                onBlur={handleCreateFolder}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreateFolder();
                  if (e.key === "Escape") {
                    setCreatingFolder(false);
                    setNewFolderName("");
                  }
                }}
                placeholder="Folder name..."
                className="w-full bg-input border border-border rounded px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                data-testid="chat-sidebar-new-agent-folder-input"
              />
            </div>
          )}

          {!agentChatsSectionCollapsed && (
            <DndContext
              sensors={sensors}
              collisionDetection={pointerWithin}
              onDragEnd={handleAgentDragEnd}
            >
              <div className="space-y-px">
                {agentFolders.map((folder) => {
                  const chats = agentChatGroups.byFolder.get(folder.id) ?? [];
                  if (chats.length === 0 && searchQuery) return null;
                  return (
                    <AgentChatFolderGroup
                      key={folder.id}
                      folder={folder}
                      collapsed={!!collapsedAgentFolders[folder.id]}
                      chatCount={chats.length}
                    >
                      {chats.map((channel) => (
                        <DraggableAgentChat key={channel.id} channelId={channel.id}>
                          <DirectMessageListItem
                            channel={channel}
                            isActive={channel.id === activeChannelId}
                            unreadCount={unreadCounts[channel.id] ?? 0}
                            isMuted={isChannelMuted(channel.id)}
                            hasDraft={draftChannels.has(channel.id)}
                            onSelect={handleChannelSelect}
                          />
                        </DraggableAgentChat>
                      ))}
                    </AgentChatFolderGroup>
                  );
                })}
                {agentChats.length === 0 && agentFolders.length === 0 ? (
                  <button
                    type="button"
                    onClick={() => dispatch(openAgentChatPicker())}
                    className="flex items-center gap-2 w-full px-3 py-1.5 mx-1.5 rounded-md text-xs text-muted-foreground hover:bg-accent hover:text-foreground transition-colors max-w-[calc(100%-12px)]"
                    data-testid="chat-sidebar-agent-chats-empty"
                  >
                    <Robot size={14} />
                    Start a new agent chat
                  </button>
                ) : (
                  <AgentUnfiledDropZone>
                    {agentChatGroups.unfiled.map((channel) => (
                      <DraggableAgentChat key={channel.id} channelId={channel.id}>
                        <DirectMessageListItem
                          channel={channel}
                          isActive={channel.id === activeChannelId}
                          unreadCount={unreadCounts[channel.id] ?? 0}
                          isMuted={isChannelMuted(channel.id)}
                          hasDraft={draftChannels.has(channel.id)}
                          onSelect={handleChannelSelect}
                        />
                      </DraggableAgentChat>
                    ))}
                  </AgentUnfiledDropZone>
                )}
              </div>
            </DndContext>
          )}
        </div>

        <div className="mx-3 my-2 h-px bg-border/60" role="separator" />

        <div
          className="mt-1"
          data-testid="chat-sidebar-dm-section"
          data-state={dmSectionCollapsed ? "collapsed" : "expanded"}
        >
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
              className="text-muted-foreground opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity hover:text-foreground"
              data-testid="chat-sidebar-new-dm-button"
            >
              <Plus size={14} />
            </button>
          </div>

          {!dmSectionCollapsed && (
            <div className="space-y-px">
              {directMessages.map((channel) => (
                <DirectMessageListItem
                  key={channel.id}
                  channel={channel}
                  isActive={channel.id === activeChannelId}
                  unreadCount={unreadCounts[channel.id] ?? 0}
                  isMuted={isChannelMuted(channel.id)}
                  hasDraft={draftChannels.has(channel.id)}
                  onSelect={handleChannelSelect}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
