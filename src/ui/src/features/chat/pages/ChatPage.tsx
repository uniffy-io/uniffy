import { useEffect, useCallback, useRef } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import { useDocumentTitle } from '@/shared/hooks/useDocumentTitle';
import { useBreakpoint } from '@/shared/hooks/useBreakpoint';
import { useShortcutHandler } from '@/features/settings';
import { AppHeader } from '@/components/layout/AppHeader';
import { useAppSelector, useAppDispatch } from '@/app/hooks';
import { cn } from '@/shared/utils/cn';
import { ChatLayout } from '@/features/chat/components/ChatLayout';
import { ChatSidebar } from '@/features/chat/components/sidebar/ChatSidebar';
import { ChannelView } from '@/features/chat/components/channel/ChannelView';
import { ThreadPanel } from '@/features/chat/components/thread/ThreadPanel';
import { ResourcePanel } from '@/features/chat/components/channel/ResourcePanel';
import { ThreadsInbox } from '@/features/chat/components/thread/ThreadsInbox';
import { UnreadsView } from '@/features/chat/components/unreads/UnreadsView';
import { setActiveChannel } from '@/features/chat/store/chatChannelsSlice';
import { recordRecentItem } from '@/features/search/utils/recentItems';
import { SearchResultType } from '@uniffy/proto/search/v1/search_pb';
import {
  toggleSidebar,
  collapseSidebar,
  deactivateSplit,
  setFocusedPane,
  openThreadPanel,
} from '@/features/chat/store/chatUiSlice';
import { setActiveThread } from '@/features/chat/store/chatThreadsSlice';
import { clearSplitChannel } from '@/features/chat/store/chatChannelsSlice';
import {
  initializeChat,
  fetchMessages,
  resolveThreadForMessage,
  jumpToChannelMessage,
} from '@/features/chat/store/chatThunks';
import { CreateChannelModal } from '@/features/chat/components/modals/CreateChannelModal';
import { CreateCategoryModal } from '@/features/chat/components/modals/CreateCategoryModal';
import { BrowseChannelsModal } from '@/features/chat/components/modals/BrowseChannelsModal';
import { NewDmModal } from '@/features/chat/components/modals/NewDmModal';
import { ChannelSettingsModal } from '@/features/chat/components/modals/ChannelSettingsModal';
import { DmMembersModal } from '@/features/chat/components/modals/DmMembersModal';
import { AgentChatPickerModal } from '@/features/chat/components/modals/AgentChatPickerModal';
import { RenameAgentChatDialog } from '@/features/chat/components/modals/RenameAgentChatDialog';
import { getChannelDisplayName } from '@/features/chat/utils/channelDisplay';
import { saveLastOpenedChannel, clearLastOpenedChannel } from '@/features/chat/utils/lastOpenedChannel';
import '@/features/chat/styles/chat.css';

export function ChatPage() {
  const dispatch = useAppDispatch();
  const { channelId } = useParams<{ channelId: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const initializedRef = useRef(false);
  const { isMobile } = useBreakpoint();

  const fromLastOpened = Boolean((location.state as { fromLastOpened?: boolean } | null)?.fromLastOpened);
  const organizationId = useAppSelector((state) => state.auth.currentOrganizationId);
  const userId = useAppSelector((state) => state.auth.user?.id);
  const channelInStore = useAppSelector((state) => (channelId ? !!state.chatChannels.byId[channelId] : false));
  const channelsLoaded = useAppSelector((state) => state.chatChannels.ids.length > 0);

  useEffect(() => {
    if (channelId && channelInStore && organizationId && userId) {
      saveLastOpenedChannel(organizationId, userId, channelId);
    }
  }, [channelId, channelInStore, organizationId, userId]);

  // A stale last-opened pointer (deleted chat, lost membership) must not trap
  // /chat in a dead redirect; deep links stay untouched and just 404 naturally.
  useEffect(() => {
    if (fromLastOpened && channelId && channelsLoaded && !channelInStore && organizationId && userId) {
      clearLastOpenedChannel(organizationId, userId);
      navigate('/chat', { replace: true });
    }
  }, [fromLastOpened, channelId, channelsLoaded, channelInStore, organizationId, userId, navigate]);

  const activeChannel = useAppSelector((state) =>
    state.chatChannels.activeChannelId
      ? state.chatChannels.byId[state.chatChannels.activeChannelId]
      : undefined,
  );
  useEffect(() => {
    if (!organizationId || !userId || !activeChannel) return;
    recordRecentItem(organizationId, userId, {
      urn: `urn:uniffy:content:${activeChannel.isAgentDm ? 'AGENT_CHAT' : 'CHAT'}:${activeChannel.id}`,
      title: getChannelDisplayName(activeChannel),
      type: activeChannel.isAgentDm ? SearchResultType.AGENT_CHAT : SearchResultType.CHAT,
      url: `/chat/${activeChannel.id}`,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- record once per channel visit, not on every unread/activity mutation of the row
  }, [organizationId, userId, activeChannel?.id]);

  const threadPanelOpen = useAppSelector((state) => state.chatUi.threadPanelOpen);
  const resourcePanelOpen = useAppSelector((state) => state.chatUi.resourcePanelOpen);
  const activeThreadId = useAppSelector((state) => state.chatThreads.activeThreadId);
  const splitActive = useAppSelector((state) => state.chatUi.splitActive);
  const splitChannelId = useAppSelector((state) => state.chatChannels.splitChannelId);
  const focusedPane = useAppSelector((state) => state.chatUi.focusedPane);
  const createChannelOpen = useAppSelector((state) => state.chatUi.createChannelModalOpen);
  const createCategoryOpen = useAppSelector((state) => state.chatUi.createCategoryModalOpen);
  const browseChannelsOpen = useAppSelector((state) => state.chatUi.browseChannelsModalOpen);
  const newDmOpen = useAppSelector((state) => state.chatUi.newDmModalOpen);
  const channelSettingsOpen = useAppSelector((state) => state.chatUi.channelSettingsModalOpen);
  const agentChatPickerOpen = useAppSelector((state) => state.chatUi.agentChatPickerOpen);
  const renameAgentChatChannelId = useAppSelector((state) => state.chatUi.renameAgentChatChannelId);
  const currentPath = typeof window !== 'undefined' ? window.location.pathname : '';
  const isThreadsInboxRoute = !channelId && currentPath === '/chat/threads';
  const isUnreadsRoute = !channelId && currentPath === '/chat/unreads';

  const pageTitle = activeChannel
    ? `#${getChannelDisplayName(activeChannel)}`
    : isThreadsInboxRoute
      ? 'Threads'
      : isUnreadsRoute
        ? 'Unreads'
        : 'Chat';
  useDocumentTitle(pageTitle);

  const handleToggleSidebar = useCallback(() => {
    dispatch(toggleSidebar());
  }, [dispatch]);
  useShortcutHandler('app.toggleSidebar', handleToggleSidebar);

  const hashMessageId = location.hash.replace('#', '') || undefined;

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;
    dispatch(initializeChat({ channelId, messageId: hashMessageId }));
    // Mobile landing inside a channel keeps the channel view visible instead of the sidebar drawer.
    if (isMobile && channelId) {
      dispatch(collapseSidebar());
    }
  }, [dispatch, channelId, hashMessageId, isMobile]);

  const prevChannelIdRef = useRef<string | undefined>(channelId);
  useEffect(() => {
    if (!initializedRef.current) return;
    if (channelId && channelId !== prevChannelIdRef.current) {
      prevChannelIdRef.current = channelId;
      dispatch(setActiveChannel(channelId));
      // With a hash the deep-link effect below loads the window around the target instead.
      if (!hashMessageId) {
        dispatch(fetchMessages({ channelId }));
      }
    }
  }, [channelId, hashMessageId, dispatch]);

  const hashHandledRef = useRef<string | null>(null);
  useEffect(() => {
    if (!hashMessageId || !channelId) return;
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
  }, [hashMessageId, channelId, location.key, dispatch]);

  useEffect(() => {
    if (splitChannelId) {
      dispatch(fetchMessages({ channelId: splitChannelId }));
    }
  }, [splitChannelId, dispatch]);

  const handleCloseSplit = useCallback(() => {
    dispatch(deactivateSplit());
    dispatch(clearSplitChannel());
  }, [dispatch]);

  const rightPanel = threadPanelOpen && activeThreadId
    ? <ThreadPanel />
    : resourcePanelOpen
      ? <ResourcePanel />
      : null;

  const splitView = splitActive && splitChannelId ? (
    <div
      className={cn('h-full', focusedPane === 'right' && 'ring-1 ring-inset ring-primary/30')}
      onMouseDown={() => dispatch(setFocusedPane('right'))}
    >
      <ChannelView
        channelId={splitChannelId}
        showCloseButton
        onClose={handleCloseSplit}
      />
    </div>
  ) : null;

  const mainContent = isThreadsInboxRoute ? (
    <ThreadsInbox />
  ) : isUnreadsRoute ? (
    <UnreadsView />
  ) : (
    <div
      className={cn('h-full', splitActive && focusedPane === 'left' && 'ring-1 ring-inset ring-primary/30')}
      onMouseDown={() => splitActive && dispatch(setFocusedPane('left'))}
    >
      <ChannelView onFocus={() => splitActive && dispatch(setFocusedPane('left'))} />
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
      {createChannelOpen && <CreateChannelModal />}
      {createCategoryOpen && <CreateCategoryModal />}
      {browseChannelsOpen && <BrowseChannelsModal />}
      {newDmOpen && <NewDmModal />}
      {channelSettingsOpen && (
        activeChannel?.channelType === 'DIRECT' || activeChannel?.channelType === 'GROUP_DM'
          ? <DmMembersModal />
          : <ChannelSettingsModal />
      )}
      {agentChatPickerOpen && <AgentChatPickerModal />}
      {renameAgentChatChannelId && <RenameAgentChatDialog />}
    </>
  );
}
