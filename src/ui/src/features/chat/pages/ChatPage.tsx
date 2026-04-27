/**
 * ChatPage - Main page component for the Chat feature.
 *
 * Handles routing, data initialization, and wires up the 3-panel layout.
 * Supports split-screen mode for viewing two channels side by side.
 */

import { useEffect, useCallback, useRef } from 'react';
import { useParams, useLocation } from 'react-router-dom';
import { useDocumentTitle } from '@/shared/hooks/useDocumentTitle';
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
import {
  toggleSidebar,
  deactivateSplit,
  setFocusedPane,
  jumpToMessage,
  openThreadPanel,
} from '@/features/chat/store/chatUiSlice';
import { setActiveThread } from '@/features/chat/store/chatThreadsSlice';
import { clearSplitChannel } from '@/features/chat/store/chatChannelsSlice';
import { initializeChat, fetchMessages, resolveThreadForMessage } from '@/features/chat/store/chatThunks';
import { CreateChannelModal } from '@/features/chat/components/modals/CreateChannelModal';
import { CreateCategoryModal } from '@/features/chat/components/modals/CreateCategoryModal';
import { BrowseChannelsModal } from '@/features/chat/components/modals/BrowseChannelsModal';
import { NewDmModal } from '@/features/chat/components/modals/NewDmModal';
import { ChannelSettingsModal } from '@/features/chat/components/modals/ChannelSettingsModal';
import '@/features/chat/styles/chat.css';

export function ChatPage() {
  const dispatch = useAppDispatch();
  const { channelId } = useParams<{ channelId: string }>();
  const location = useLocation();
  const initializedRef = useRef(false);

  const activeChannel = useAppSelector((state) =>
    state.chatChannels.channels.find(c => c.id === state.chatChannels.activeChannelId)
  );
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
  const currentPath = typeof window !== 'undefined' ? window.location.pathname : '';
  const isThreadsInboxRoute = !channelId && currentPath === '/chat/threads';
  const isUnreadsRoute = !channelId && currentPath === '/chat/unreads';

  const pageTitle = activeChannel?.name
    ? `#${activeChannel.name}`
    : isThreadsInboxRoute
      ? 'Threads'
      : isUnreadsRoute
        ? 'Unreads'
        : 'Chat';
  useDocumentTitle(pageTitle);

  // Keyboard shortcut: Ctrl+B toggles sidebar
  const handleToggleSidebar = useCallback(() => {
    dispatch(toggleSidebar());
  }, [dispatch]);
  useShortcutHandler('app.toggleSidebar', handleToggleSidebar);

  // Parse message ID from URL hash
  const hashMessageId = location.hash.replace('#', '') || undefined;

  // Initialize chat data on mount
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;
    dispatch(initializeChat({ channelId, messageId: hashMessageId }));
  }, [dispatch, channelId, hashMessageId]);

  // Handle channel selection from URL changes (after initial load)
  const prevChannelIdRef = useRef<string | undefined>(channelId);
  useEffect(() => {
    if (!initializedRef.current) return;
    if (channelId && channelId !== prevChannelIdRef.current) {
      prevChannelIdRef.current = channelId;
      dispatch(setActiveChannel(channelId));
      dispatch(fetchMessages({ channelId }));
    }
  }, [channelId, dispatch]);

  // Jump to message from URL hash fragment after messages load
  const hashHandledRef = useRef(false);
  const channelMessageIds = useAppSelector((state) =>
    channelId ? state.chatMessages.idsByChannel[channelId] : undefined,
  );
  const messagesLoaded = (channelMessageIds?.length ?? 0) > 0;
  useEffect(() => {
    if (hashHandledRef.current || !hashMessageId || !messagesLoaded || !channelId) return;
    hashHandledRef.current = true;

    (async () => {
      const result = await dispatch(
        resolveThreadForMessage({ channelId, messageId: hashMessageId }),
      ).unwrap();

      if (result) {
        dispatch(setActiveThread(result.rootMessageId));
        dispatch(openThreadPanel());
      }
      dispatch(jumpToMessage(hashMessageId));
    })();
  }, [hashMessageId, messagesLoaded, channelId, dispatch]);

  // Load messages for split channel when it changes
  useEffect(() => {
    if (splitChannelId) {
      dispatch(fetchMessages({ channelId: splitChannelId }));
    }
  }, [splitChannelId, dispatch]);

  const handleCloseSplit = useCallback(() => {
    dispatch(deactivateSplit());
    dispatch(clearSplitChannel());
  }, [dispatch]);

  // Right panel: thread panel or resource panel (mutex)
  const rightPanel = threadPanelOpen && activeThreadId
    ? <ThreadPanel />
    : resourcePanelOpen
      ? <ResourcePanel />
      : null;

  // Split channel view
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

  // Primary channel view with focus ring when split is active
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
      {channelSettingsOpen && <ChannelSettingsModal />}
    </>
  );
}
