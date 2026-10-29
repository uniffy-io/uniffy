import { Link } from "react-router-dom";
import { useCall } from "@/features/calls/components/callContext";
import { callAvailabilityMessage } from "@/features/calls/utils/callErrors";
import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { useOverlayEscape } from "@/shared/hooks/useOverlayEscape";
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
  Phone,
  ClockCounterClockwise,
} from "@phosphor-icons/react";
import { useAppSelector, useAppDispatch } from "@/app/hooks";
import { useTagsByIds } from "@/features/tags/store/selectors";
import { selectActiveChannel } from "@/features/chat/store/chatChannelsSlice";
import {
  toggleChannelHeaderExpanded,
  selectChannelHeaderExpanded,
  selectSplitActive,
  deactivateSplit,
  expandSidebar,
  selectSidebarOpen,
} from "@/features/chat/store/chatUiSlice";
import { ChatSearchPanel } from "@/features/chat/components/search/ChatSearchPanel";
import { setSplitChannel, clearSplitChannel } from "@/features/chat/store/chatChannelsSlice";
import { activateSplit, openChannelSettingsModal } from "@/features/chat/store/chatUiSlice";
import { openResourcePanel, selectResourcePanelOpen } from "@/features/chat/store/chatUiSlice";
import { AgentAvatar } from "@/features/agents/components/AgentAvatar";
import { AgentContextBar } from "@/features/chat/components/channel/AgentContextBar";
import { ChannelAgentsPopover } from "@/features/chat/components/channel/ChannelAgentsPopover";
import { CustomStatusDisplay } from "@/features/presence/components/CustomStatusDisplay";
import { CallAvailability } from "@uniffy/proto/calls/v1/calls_pb";
import { cn } from "@/shared/utils/cn";
import { formatDateFull } from "@/shared/utils/dateFormatting";
import { useBreakpoint } from "@/shared/hooks/useBreakpoint";
import { SplitChannelPicker } from "@/features/chat/components/channel/SplitChannelPicker";
import { PinnedMessagesPanel } from "@/features/chat/components/channel/PinnedMessagesPanel";
import { ChannelNextMeeting } from "@/features/chat/components/channel/ChannelNextMeeting";
import { selectPinnedCountForChannel } from "@/features/chat/store/chatMessagesSlice";
import { Input } from "@/components/ui/input";
import { renameAgentChat, jumpToChannelMessage } from "@/features/chat/store/chatThunks";
import {
  getChannelDisplayName,
  getDmDisplayName,
  getDmPeerUserId,
} from "@/features/chat/utils/channelDisplay";
import { SubjectAvatarById } from "@/components/subject";
import { TagChip } from "@/features/tags";
import {
  prejoinOpened,
  selectActiveCallForChannel,
  selectCallSession,
} from "@/features/calls/store/callsSlice";

const headerButtonClass = cn(
  "focus-ring group/btn relative flex items-center justify-center h-7 w-7 rounded-md",
  "border border-border-strong bg-transparent text-muted-foreground",
  "transition-all duration-300 ease-out",
  "hover:border-border-strong hover:bg-muted hover:text-primary",
);

const headerButtonActiveClass =
  "text-primary bg-primary/10 border-primary/50 hover:border-primary/50 hover:bg-primary/10";

const headerChipClass = cn(
  "focus-ring group/btn flex items-center gap-1 h-7 px-1.5 rounded-md",
  "border border-border-strong bg-transparent text-xs text-muted-foreground",
  "transition-all duration-300 ease-out",
  "hover:border-border-strong hover:bg-muted hover:text-primary",
);

interface ChannelHeaderProps {
  channelId?: string;
  showCloseButton?: boolean;
  onClose?: () => void;
  /** Hero state of an empty agent DM: no bar, only the navigation controls float over it. */
  bare?: boolean;
}

export function ChannelHeader({ channelId, showCloseButton, onClose, bare }: ChannelHeaderProps) {
  const { availability } = useCall();
  const callUnavailableMessage = callAvailabilityMessage(availability);
  // Still checking reads as a normal call button; a known refusal reads as disabled.
  const callsUnavailable =
    availability !== CallAvailability.READY && availability !== CallAvailability.UNSPECIFIED;
  const dispatch = useAppDispatch();
  const defaultActiveChannel = useAppSelector(selectActiveChannel);
  const channelFromId = useAppSelector((state) =>
    channelId ? state.chatChannels.byId[channelId] : undefined,
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

  useOverlayEscape(() => setShowPicker(false), showPicker);

  const handleSplitClick = useCallback(() => {
    if (splitActive) {
      dispatch(deactivateSplit());
      dispatch(clearSplitChannel());
    } else {
      setShowPicker(true);
    }
  }, [dispatch, splitActive]);

  const handlePickerSelect = useCallback(
    (selectedChannelId: string) => {
      dispatch(setSplitChannel(selectedChannelId));
      dispatch(activateSplit());
      setShowPicker(false);
    },
    [dispatch],
  );

  const currentUserName = useAppSelector((s) => s.auth.user?.fullName ?? "");
  const currentUserId = useAppSelector((s) => s.auth.user?.id ?? "");
  const pinnedCount = useAppSelector((state) =>
    activeChannel ? selectPinnedCountForChannel(state, activeChannel.id) : 0,
  );

  const isDm = activeChannel?.channelType === "DIRECT" || activeChannel?.channelType === "GROUP_DM";
  const isOneOnOneDm = activeChannel?.channelType === "DIRECT";
  const isAgentDm = !!activeChannel?.isAgentDm;
  const isSelfDm = !!activeChannel?.isSelfDm;

  // Their own status beside their own name repeats what the avatar menu shows.
  const dmPeerUserId = useMemo(
    () => (activeChannel && !isSelfDm ? getDmPeerUserId(activeChannel, currentUserId) : ""),
    [activeChannel, isSelfDm, currentUserId],
  );

  const agent = useAppSelector((state) =>
    isAgentDm && activeChannel?.agentId
      ? (state.agents.agents[activeChannel.agentId] ?? null)
      : null,
  );

  // Always show the Gauge icon on group channels; gating on member-load caused flicker.
  const isGroupChannel = !isOneOnOneDm;

  const headerName = useMemo(() => {
    if (!activeChannel) return "";
    if (!isDm) return activeChannel.name;
    return getDmDisplayName(activeChannel, currentUserName);
  }, [isDm, activeChannel, currentUserName]);

  const [isEditingName, setIsEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
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
      setNameDraft(activeChannel.customName ?? "");
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
      await dispatch(renameAgentChat({ channelId: activeChannel.id, customName: next })).unwrap();
    } finally {
      setIsSavingName(false);
      setIsEditingName(false);
    }
    // The deps below ARE read in the body; oxlint's memo analysis misses reads
    // inside try/finally blocks and object-literal call arguments.
    // eslint-disable-next-line react/react-compiler
  }, [activeChannel, isAgentDm, nameDraft, dispatch]);

  const handleNameKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        void submitNameDraft();
      } else if (e.key === "Escape") {
        e.preventDefault();
        setIsEditingName(false);
      }
    },
    [submitNameDraft],
  );

  const channelTags = useTagsByIds(activeChannel?.tagIds ?? []);

  const activeCall = useAppSelector((state) =>
    activeChannel ? selectActiveCallForChannel(state, activeChannel.id) : null,
  );
  const callSession = useAppSelector(selectCallSession);
  const inCallHere = callSession.channelId === activeChannel?.id && callSession.status !== "idle";

  if (!activeChannel) return null;

  if (bare) {
    const showMobileToggle = isMobile && !sidebarOpen && !showCloseButton;
    const showSplitClose = showCloseButton && onClose;
    if (!showMobileToggle && !showSplitClose) return null;
    return (
      <div
        className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-center justify-between px-4 py-2"
        data-testid="chat-channel-header"
        data-channel-id={activeChannel.id}
        data-channel-type={activeChannel.channelType}
        data-bare="true"
      >
        {showMobileToggle ? (
          <button
            type="button"
            onClick={() => dispatch(expandSidebar())}
            className={cn(headerButtonClass, "pointer-events-auto shrink-0")}
            aria-label="Open chat navigation"
            data-testid="chat-channel-mobile-sidebar-toggle"
          >
            <SidebarSimple size={16} />
          </button>
        ) : (
          <span />
        )}
        {showSplitClose ? (
          <button
            type="button"
            onClick={onClose}
            className={cn(headerButtonClass, "pointer-events-auto")}
            aria-label="Close split pane"
            data-testid="chat-channel-close-split-button"
          >
            <X size={16} />
          </button>
        ) : null}
      </div>
    );
  }

  const isPrivate = activeChannel.channelType === "PRIVATE";
  const ChannelIcon = isPrivate ? Lock : Hash;
  const createdDate = formatDateFull(activeChannel.createdAt);
  const currentChannelId = activeChannel.id;

  return (
    <div
      className="border-b border-border-strong bg-surface"
      data-testid="chat-channel-header"
      data-channel-id={activeChannel.id}
      data-channel-type={activeChannel.channelType}
    >
      <div className="flex items-center gap-3 px-4 py-2">
        {isMobile && !sidebarOpen && !showCloseButton && (
          <button
            type="button"
            onClick={() => dispatch(expandSidebar())}
            className={cn(headerButtonClass, "shrink-0")}
            aria-label="Open chat navigation"
            data-testid="chat-channel-mobile-sidebar-toggle"
          >
            <SidebarSimple size={16} />
          </button>
        )}
        {!isDm && <ChannelIcon size={16} className="text-muted-foreground shrink-0" />}
        {isAgentDm && (
          <AgentAvatar
            avatarKey={agent?.avatarKey}
            avatarEmoji={agent?.avatarEmoji}
            agentName={agent?.name ?? headerName}
            size="sm"
          />
        )}
        {isSelfDm && (
          <SubjectAvatarById userId={currentUserId} displayName={currentUserName} size="sm" />
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
            className="h-7 text-[15px] font-semibold w-56"
            data-testid="chat-channel-name-input"
          />
        ) : (
          <button
            type="button"
            onClick={handleNameClick}
            className="flex min-w-0 items-center gap-1 text-[15px] font-semibold tracking-[-0.01em] text-foreground cursor-pointer hover:text-foreground/80 transition-colors"
            data-testid="chat-channel-name"
            title={isAgentDm ? "Click to rename" : headerName}
          >
            <span className="truncate">{headerName}</span>
            {dmPeerUserId && (
              <CustomStatusDisplay userId={dmPeerUserId} className="text-sm" compact />
            )}
            {!isDm && (isExpanded ? <CaretUp size={12} /> : <CaretDown size={12} />)}
          </button>
        )}

        {!(activeChannel.channelType === "DIRECT") && (
          <button
            type="button"
            onClick={() => dispatch(openChannelSettingsModal("members"))}
            className={headerChipClass}
            data-testid="chat-channel-members-button"
            title={`${activeChannel.memberCount} members`}
          >
            <Users size={14} weight="regular" />
            <span className="font-medium tabular-nums">{activeChannel.memberCount}</span>
          </button>
        )}

        <div className="flex-1" />

        <div className="flex items-center gap-1.5">
          {!isAgentDm && !isSelfDm && !isMobile && (
            <Link
              to={`/calls?channelId=${activeChannel.id}`}
              className={headerButtonClass}
              title="Call history"
              aria-label="Channel call history"
            >
              <ClockCounterClockwise size={16} />
            </Link>
          )}
          {!isAgentDm && !isSelfDm && !inCallHere && (
            <button
              type="button"
              onClick={() => dispatch(prejoinOpened({ channelId: activeChannel.id }))}
              className={cn(
                activeCall ? headerChipClass : headerButtonClass,
                activeCall &&
                  "border-green-600/40 text-green-600 hover:border-green-600/60 hover:text-green-600 dark:border-green-400/40 dark:text-green-400 dark:hover:border-green-400/60 dark:hover:text-green-400",
                callsUnavailable && "opacity-40",
              )}
              aria-label={
                callsUnavailable
                  ? "Calls unavailable"
                  : activeCall
                    ? "Join live call"
                    : "Start call"
              }
              title={
                callsUnavailable
                  ? (callUnavailableMessage ?? undefined)
                  : activeCall
                    ? "Join live call"
                    : "Start call"
              }
              data-testid="chat-channel-call-button"
              data-state={callsUnavailable ? "unavailable" : activeCall ? "live" : "idle"}
            >
              <Phone size={16} weight={activeCall ? "fill" : "regular"} />
              {activeCall && (
                <span className="font-medium tabular-nums">{activeCall.participants.length}</span>
              )}
            </button>
          )}
          {isAgentDm && agent && (
            <button
              type="button"
              onClick={() => setShowContextBar((prev) => !prev)}
              className={cn(headerButtonClass, showContextBar && headerButtonActiveClass)}
              aria-label={showContextBar ? "Hide agent context" : "Show agent context"}
              title="Agent context"
              data-testid="chat-channel-agent-context-toggle"
              data-state={showContextBar ? "open" : "closed"}
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
              aria-label={showAgentsPopover ? "Hide agent context" : "Show agent context"}
              title="Agent context"
              data-testid="chat-channel-agents-toggle"
              data-state={showAgentsPopover ? "open" : "closed"}
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
            onClick={() => setShowSearch((prev) => !prev)}
            className={cn(headerButtonClass, showSearch && headerButtonActiveClass)}
            aria-label="Search messages"
            data-testid="chat-channel-search-button"
            data-state={showSearch ? "open" : "closed"}
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
            onClick={() => setShowPinned((prev) => !prev)}
            className={cn(headerButtonClass, showPinned && headerButtonActiveClass)}
            aria-label="Pinned messages"
            data-testid="chat-channel-pinned-button"
            data-state={showPinned ? "open" : "closed"}
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
              onJumpToMessage={(messageId) =>
                dispatch(
                  jumpToChannelMessage({
                    channelId: activeChannel.id,
                    messageId,
                  }),
                )
              }
            />
          )}

          <button
            type="button"
            onClick={() => dispatch(openResourcePanel())}
            className={cn(headerButtonClass, resourcePanelOpen && headerButtonActiveClass)}
            aria-label="Channel resources"
            data-testid="chat-channel-resources-button"
            data-state={resourcePanelOpen ? "open" : "closed"}
          >
            <LinkSimple size={16} />
          </button>

          {!isMobileOrTablet && !showCloseButton && (
            <div className="relative">
              <button
                ref={splitBtnRef}
                type="button"
                onClick={handleSplitClick}
                className={cn(headerButtonClass, splitActive && headerButtonActiveClass)}
                aria-label={splitActive ? "Close split view" : "Open split view"}
                data-testid="chat-channel-split-button"
                data-state={splitActive ? "active" : "inactive"}
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

          {activeChannel.channelType !== "DIRECT" && activeChannel.channelType !== "GROUP_DM" && (
            <button
              type="button"
              onClick={() => dispatch(openChannelSettingsModal("overview"))}
              className={headerButtonClass}
              aria-label="Channel settings"
              data-testid="chat-channel-settings-button"
            >
              <GearSix size={16} />
            </button>
          )}

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

      {isAgentDm && agent && showContextBar && (
        <AgentContextBar channelId={activeChannel.id} agentId={agent.id} agentName={agent.name} />
      )}

      {!isDm && (
        <div
          className={cn(
            "overflow-hidden transition-[max-height,opacity] duration-200 ease-out",
            isExpanded ? "max-h-48 opacity-100" : "max-h-0 opacity-0",
          )}
        >
          <div className="px-4 py-2 border-t border-border/50 space-y-1.5">
            {activeChannel.description && (
              <p className="text-sm text-muted-foreground">{activeChannel.description}</p>
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
            <p className="text-xs text-muted-foreground">Created on {createdDate}</p>
          </div>
        </div>
      )}

      <ChannelNextMeeting channelId={activeChannel.id} />
    </div>
  );
}
