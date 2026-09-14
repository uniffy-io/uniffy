import { clearUnreadSeparator } from "@/features/chat/store/chatMessagesSlice";
import { Suspense, useEffect, useCallback, useRef, type ReactNode } from "react";
import { useParams, useLocation, useNavigate } from "react-router-dom";
import { SpinnerGap } from "@phosphor-icons/react";
import { useDocumentTitle } from "@/shared/hooks/useDocumentTitle";
import { useBreakpoint } from "@/shared/hooks/useBreakpoint";
import { lazyImport } from "@/shared/utils/lazyImport";
import { useShortcutHandler } from "@/features/settings";
import { AppHeader } from "@/components/layout/AppHeader";
import { PageLoader } from "@/components/feedback/PageLoader";
import { useAppSelector, useAppDispatch } from "@/app/hooks";
import { cn } from "@/shared/utils/cn";
import { ChatLayout } from "@/features/chat/components/ChatLayout";
import { ChatSidebar } from "@/features/chat/components/sidebar/ChatSidebar";
import { ChannelView } from "@/features/chat/components/channel/ChannelView";
import {
  selectChannels,
  selectChannelsLoaded,
  setActiveChannel,
  clearManualUnread,
} from "@/features/chat/store/chatChannelsSlice";
import { recordRecentItem } from "@/features/search/utils/recentItems";
import { SearchResultType } from "@uniffy/proto/search/v1/search_pb";
import {
  toggleSidebar,
  collapseSidebar,
  deactivateSplit,
  setFocusedPane,
  openThreadPanel,
  closeThreadPanel,
  closeResourcePanel,
  selectThreadPane,
} from "@/features/chat/store/chatUiSlice";
import { setActiveThread } from "@/features/chat/store/chatThreadsSlice";
import { clearSplitChannel } from "@/features/chat/store/chatChannelsSlice";
import {
  initializeChat,
  hydrateChat,
  fetchMessages,
  fetchChannel,
  resolveThreadForMessage,
  jumpToChannelMessage,
} from "@/features/chat/store/chatThunks";
import { getChannelDisplayName } from "@/features/chat/utils/channelDisplay";
import {
  saveLastOpenedChannel,
  loadLastOpenedChannel,
  clearLastOpenedChannel,
} from "@/features/chat/utils/lastOpenedChannel";
import { chooseChatLanding } from "@/features/chat/utils/landing";
import "@/features/chat/styles/chat.css";

const ThreadPanel = lazyImport(
  () => import("@/features/chat/components/thread/ThreadPanel"),
  "ThreadPanel",
);
const ResourcePanel = lazyImport(
  () => import("@/features/chat/components/channel/ResourcePanel"),
  "ResourcePanel",
);
const ThreadsInbox = lazyImport(
  () => import("@/features/chat/components/thread/ThreadsInbox"),
  "ThreadsInbox",
);
const UnreadsView = lazyImport(
  () => import("@/features/chat/components/unreads/UnreadsView"),
  "UnreadsView",
);
const DraftsView = lazyImport(
  () => import("@/features/chat/components/drafts/DraftsView"),
  "DraftsView",
);
const CreateChannelModal = lazyImport(
  () => import("@/features/chat/components/modals/CreateChannelModal"),
  "CreateChannelModal",
);
const CreateCategoryModal = lazyImport(
  () => import("@/features/chat/components/modals/CreateCategoryModal"),
  "CreateCategoryModal",
);
const BrowseChannelsModal = lazyImport(
  () => import("@/features/chat/components/modals/BrowseChannelsModal"),
  "BrowseChannelsModal",
);
const NewDmModal = lazyImport(
  () => import("@/features/chat/components/modals/NewDmModal"),
  "NewDmModal",
);
const ChannelSettingsModal = lazyImport(
  () => import("@/features/chat/components/modals/ChannelSettingsModal"),
  "ChannelSettingsModal",
);
const DmMembersModal = lazyImport(
  () => import("@/features/chat/components/modals/DmMembersModal"),
  "DmMembersModal",
);
const AgentChatPickerModal = lazyImport(
  () => import("@/features/chat/components/modals/AgentChatPickerModal"),
  "AgentChatPickerModal",
);
const RenameAgentChatDialog = lazyImport(
  () => import("@/features/chat/components/modals/RenameAgentChatDialog"),
  "RenameAgentChatDialog",
);

function DeferredChatSurface({ children }: { children: ReactNode }) {
  return <Suspense fallback={<PageLoader className="h-full min-h-0" />}>{children}</Suspense>;
}

function DeferredChatDialog({ children }: { children: ReactNode }) {
  return (
    <Suspense
      fallback={
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-background/70 backdrop-blur-sm"
          role="status"
          aria-label="Loading dialog"
        >
          <SpinnerGap size={32} className="animate-spin text-primary" />
        </div>
      }
    >
      {children}
    </Suspense>
  );
}

function routeSnapshotIsCurrent(pathname: string): boolean {
  // BrowserRouter writes history before a concurrent route render commits.
  return pathname === window.location.pathname;
}

export function ChatPage() {
  const dispatch = useAppDispatch();
  const { channelId } = useParams<{ channelId: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const initializedRef = useRef(false);
  const hydrationStartedRef = useRef(false);
  const landingNavigationStartedRef = useRef(false);
  const channelRequestRef = useRef<string | null>(null);
  const { isMobile, isMobileOrTablet } = useBreakpoint();

  const organizationId = useAppSelector((state) => state.auth.currentOrganizationId);
  const userId = useAppSelector((state) => state.auth.user?.id);
  const channels = useAppSelector(selectChannels);
  const channelsLoaded = useAppSelector(selectChannelsLoaded);
  const channelRevision = useAppSelector(
    (state) =>
      `${state.chatChannels.revision}:${state.chatChannels.revisionsById[channelId ?? ""] ?? 0}`,
  );
  const channelInStore = useAppSelector((state) =>
    channelId ? !!state.chatChannels.byId[channelId] : false,
  );
  const routeChannel = useAppSelector((state) =>
    channelId ? state.chatChannels.byId[channelId] : undefined,
  );
  const channelMessagesSettled = useAppSelector((state) =>
    channelId
      ? state.chatMessages.idsByChannel[channelId] !== undefined ||
        !!state.chatMessages.initialLoadFailedByChannel[channelId]
      : false,
  );
  const currentPath = location.pathname;
  const isChatIndexRoute = !channelId && currentPath === "/chat";
  const isThreadsInboxRoute = !channelId && currentPath === "/chat/threads";
  const isUnreadsRoute = !channelId && currentPath === "/chat/unreads";
  const isDraftsRoute = !channelId && currentPath === "/chat/drafts";

  useEffect(() => {
    if (channelInStore) {
      channelRequestRef.current = null;
      return;
    }
    if (!channelId || !organizationId || !channelsLoaded || !routeSnapshotIsCurrent(currentPath))
      return;
    const key = `${organizationId}:${userId}:${channelId}:${channelRevision}`;
    if (channelRequestRef.current === key) return;
    channelRequestRef.current = key;
    void dispatch(fetchChannel(channelId))
      .unwrap()
      .catch(() => {
        if (channelRequestRef.current !== key || !routeSnapshotIsCurrent(currentPath) || !userId)
          return;
        clearLastOpenedChannel(organizationId, userId);
        navigate("/chat", { replace: true });
      });
  }, [
    channelId,
    channelRevision,
    organizationId,
    userId,
    channelInStore,
    channelsLoaded,
    currentPath,
    dispatch,
    navigate,
  ]);

  useEffect(() => {
    if (
      landingNavigationStartedRef.current ||
      !isChatIndexRoute ||
      !routeSnapshotIsCurrent(currentPath) ||
      !channelsLoaded ||
      !organizationId ||
      !userId
    ) {
      return;
    }

    const lastOpenedId = loadLastOpenedChannel(organizationId, userId);
    const landingId = chooseChatLanding(channels, lastOpenedId);
    if (lastOpenedId && landingId !== lastOpenedId) {
      clearLastOpenedChannel(organizationId, userId);
    }
    if (landingId) {
      landingNavigationStartedRef.current = true;
      navigate(`/chat/${landingId}`, { replace: true });
    }
  }, [isChatIndexRoute, currentPath, channelsLoaded, channels, organizationId, userId, navigate]);

  useEffect(() => {
    if (
      channelId &&
      routeSnapshotIsCurrent(currentPath) &&
      channelInStore &&
      organizationId &&
      userId
    ) {
      saveLastOpenedChannel(organizationId, userId, channelId);
    }
  }, [channelId, channelInStore, organizationId, userId, currentPath]);

  const activeChannel = useAppSelector((state) =>
    state.chatChannels.activeChannelId
      ? state.chatChannels.byId[state.chatChannels.activeChannelId]
      : undefined,
  );
  useEffect(() => {
    if (!routeSnapshotIsCurrent(currentPath) || !organizationId || !userId || !routeChannel) {
      return;
    }
    recordRecentItem(organizationId, userId, {
      urn: `urn:uniffy:content:${routeChannel.isAgentDm ? "AGENT_CHAT" : "CHAT"}:${routeChannel.id}`,
      title: getChannelDisplayName(routeChannel),
      type: routeChannel.isAgentDm ? SearchResultType.AGENT_CHAT : SearchResultType.CHAT,
      url: `/chat/${routeChannel.id}`,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- record once per channel visit, not on every unread/activity mutation of the row
  }, [organizationId, userId, routeChannel?.id, currentPath]);

  const threadPanelOpen = useAppSelector((state) => state.chatUi.threadPanelOpen);
  const resourcePanelOpen = useAppSelector((state) => state.chatUi.resourcePanelOpen);
  const activeThreadId = useAppSelector((state) => state.chatThreads.activeThreadId);
  const splitActive = useAppSelector((state) => state.chatUi.splitActive);
  const threadPane = useAppSelector(selectThreadPane);
  const splitChannelId = useAppSelector((state) => state.chatChannels.splitChannelId);
  const focusedPane = useAppSelector((state) => state.chatUi.focusedPane);
  const createChannelOpen = useAppSelector((state) => state.chatUi.createChannelModalOpen);
  const createCategoryOpen = useAppSelector((state) => state.chatUi.createCategoryModalOpen);
  const browseChannelsOpen = useAppSelector((state) => state.chatUi.browseChannelsModalOpen);
  const newDmOpen = useAppSelector((state) => state.chatUi.newDmModalOpen);
  const channelSettingsOpen = useAppSelector((state) => state.chatUi.channelSettingsModalOpen);
  const agentChatPickerOpen = useAppSelector((state) => state.chatUi.agentChatPickerOpen);
  const renameAgentChatChannelId = useAppSelector((state) => state.chatUi.renameAgentChatChannelId);
  const pageTitle = isThreadsInboxRoute
    ? "Threads"
    : isUnreadsRoute
      ? "Unreads"
      : isDraftsRoute
        ? "Drafts"
        : routeChannel
          ? `#${getChannelDisplayName(routeChannel)}`
          : "Chat";
  useDocumentTitle(pageTitle);

  const handleToggleSidebar = useCallback(() => {
    dispatch(toggleSidebar());
  }, [dispatch]);
  useShortcutHandler("app.toggleSidebar", handleToggleSidebar);

  const hashMessageId = location.hash.replace("#", "") || undefined;

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;
    dispatch(initializeChat());
  }, [dispatch]);

  useEffect(() => {
    if (hydrationStartedRef.current || !routeSnapshotIsCurrent(currentPath) || !channelsLoaded) {
      return;
    }
    if (channelId && channelInStore && !channelMessagesSettled) return;
    if (isChatIndexRoute && channels.length > 0) return;
    hydrationStartedRef.current = true;
    dispatch(hydrateChat());
  }, [
    dispatch,
    currentPath,
    channelsLoaded,
    channelId,
    channelInStore,
    channelMessagesSettled,
    isChatIndexRoute,
    channels.length,
  ]);

  useEffect(() => {
    if (isMobile && channelId) {
      dispatch(collapseSidebar());
    }
  }, [dispatch, channelId, isMobile]);

  useEffect(() => {
    if (!channelId || !routeSnapshotIsCurrent(currentPath) || !channelInStore) return;

    dispatch(setActiveChannel(channelId));
    // Opening the channel is what ends a manual unread, and it has to land
    // before the load below decides whether to mark the channel read.
    dispatch(clearManualUnread(channelId));
    dispatch(clearUnreadSeparator(channelId));
    // With a hash the deep-link effect below loads the window around the target instead.
    if (!hashMessageId) {
      dispatch(fetchMessages({ channelId }));
    }
  }, [channelId, channelInStore, hashMessageId, dispatch, currentPath]);

  const hashHandledRef = useRef<string | null>(null);
  useEffect(() => {
    if (!hashMessageId || !channelId || !routeSnapshotIsCurrent(currentPath) || !channelInStore) {
      return;
    }
    // Keyed on the history entry so clicking the same search result twice jumps again.
    const target = `${location.key}:${channelId}#${hashMessageId}`;
    if (hashHandledRef.current === target) return;
    hashHandledRef.current = target;

    (async () => {
      const result = await dispatch(
        resolveThreadForMessage({ channelId, messageId: hashMessageId }),
      ).unwrap();

      if (result) {
        dispatch(setActiveThread(result.rootMessageId));
        dispatch(openThreadPanel());
      }
      // Thread replies never appear in the channel list, so the list scrolls to their root.
      const listTarget = result ? result.rootMessageId : hashMessageId;
      await dispatch(jumpToChannelMessage({ channelId, messageId: listTarget }));
    })();
  }, [hashMessageId, channelId, channelInStore, location.key, currentPath, dispatch]);

  useEffect(() => {
    if (splitChannelId) {
      dispatch(clearUnreadSeparator(splitChannelId));
      dispatch(clearManualUnread(splitChannelId));
      dispatch(fetchMessages({ channelId: splitChannelId }));
    }
  }, [splitChannelId, dispatch]);

  const handleCloseSplit = useCallback(() => {
    dispatch(deactivateSplit());
    dispatch(clearSplitChannel());
  }, [dispatch]);

  // In split screen the owning ChannelView hosts the thread as a slide-over.
  const threadInPane = !!threadPane && !isMobileOrTablet;

  const rightPanelKind =
    threadPanelOpen && activeThreadId && !threadInPane
      ? "thread"
      : resourcePanelOpen
        ? "resources"
        : null;

  const handleCloseRightPanel = useCallback(() => {
    if (rightPanelKind === "thread") dispatch(closeThreadPanel());
    else if (rightPanelKind === "resources") dispatch(closeResourcePanel());
  }, [dispatch, rightPanelKind]);

  const rightPanel =
    rightPanelKind === "thread"
      ? {
          node: (
            <DeferredChatSurface>
              <ThreadPanel />
            </DeferredChatSurface>
          ),
          label: "Thread panel",
          onClose: handleCloseRightPanel,
        }
      : rightPanelKind === "resources"
        ? {
            node: (
              <DeferredChatSurface>
                <ResourcePanel />
              </DeferredChatSurface>
            ),
            label: "Channel resources",
            onClose: handleCloseRightPanel,
          }
        : null;

  const splitView =
    splitActive && splitChannelId ? (
      <div
        className={cn("h-full", focusedPane === "right" && "ring-1 ring-inset ring-primary/30")}
        onMouseDown={() => dispatch(setFocusedPane("right"))}
      >
        <ChannelView
          channelId={splitChannelId}
          pane="right"
          showCloseButton
          onClose={handleCloseSplit}
        />
      </div>
    ) : null;

  const mainContent = isThreadsInboxRoute ? (
    <DeferredChatSurface>
      <ThreadsInbox />
    </DeferredChatSurface>
  ) : isUnreadsRoute ? (
    <DeferredChatSurface>
      <UnreadsView />
    </DeferredChatSurface>
  ) : isDraftsRoute ? (
    <DeferredChatSurface>
      <DraftsView />
    </DeferredChatSurface>
  ) : (
    <div
      className={cn(
        "h-full",
        splitActive && focusedPane === "left" && "ring-1 ring-inset ring-primary/30",
      )}
      onMouseDown={() => splitActive && dispatch(setFocusedPane("left"))}
    >
      <ChannelView
        channelId={channelId}
        pane="left"
        onFocus={() => splitActive && dispatch(setFocusedPane("left"))}
      />
    </div>
  );

  return (
    <>
      <AppHeader />
      <ChatLayout
        sidebar={<ChatSidebar />}
        channelView={mainContent}
        splitView={splitView}
        rightPanel={rightPanel}
      />
      {createChannelOpen && (
        <DeferredChatDialog>
          <CreateChannelModal />
        </DeferredChatDialog>
      )}
      {createCategoryOpen && (
        <DeferredChatDialog>
          <CreateCategoryModal />
        </DeferredChatDialog>
      )}
      {browseChannelsOpen && (
        <DeferredChatDialog>
          <BrowseChannelsModal />
        </DeferredChatDialog>
      )}
      {newDmOpen && (
        <DeferredChatDialog>
          <NewDmModal />
        </DeferredChatDialog>
      )}
      {channelSettingsOpen &&
        (activeChannel?.channelType === "DIRECT" || activeChannel?.channelType === "GROUP_DM" ? (
          <DeferredChatDialog>
            <DmMembersModal />
          </DeferredChatDialog>
        ) : (
          <DeferredChatDialog>
            <ChannelSettingsModal />
          </DeferredChatDialog>
        ))}
      {agentChatPickerOpen && (
        <DeferredChatDialog>
          <AgentChatPickerModal />
        </DeferredChatDialog>
      )}
      {renameAgentChatChannelId && (
        <DeferredChatDialog>
          <RenameAgentChatDialog />
        </DeferredChatDialog>
      )}
    </>
  );
}
