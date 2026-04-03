/**
 * ChatPage - Main page component for the Chat feature.
 *
 * Handles routing, data initialization, and wires up the 3-panel layout.
 * Supports split-screen mode for viewing two channels side by side.
 */

import { useEffect, useCallback, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { useDocumentTitle } from '@/shared/hooks/useDocumentTitle';
import { useShortcutHandler } from '@/features/settings';
import { AppHeader } from '@/components/layout/AppHeader';
import { useAppSelector, useAppDispatch } from '@/app/hooks';
import { cn } from '@/shared/utils/cn';
import { ChatLayout } from '@/features/chat/components/ChatLayout';
import { ChatSidebar } from '@/features/chat/components/sidebar/ChatSidebar';
import { ChannelView } from '@/features/chat/components/channel/ChannelView';
import { ThreadPanel } from '@/features/chat/components/thread/ThreadPanel';
import { ThreadsInbox } from '@/features/chat/components/thread/ThreadsInbox';
import { UnreadsView } from '@/features/chat/components/unreads/UnreadsView';
import { setActiveChannel } from '@/features/chat/store/chatChannelsSlice';
import {
  toggleSidebar,
  deactivateSplit,
  setFocusedPane,
} from '@/features/chat/store/chatUiSlice';
import { clearSplitChannel } from '@/features/chat/store/chatChannelsSlice';
import { initializeChat, fetchMessages } from '@/features/chat/store/chatThunks';
import { CreateChannelModal } from '@/features/chat/components/modals/CreateChannelModal';
import { CreateCategoryModal } from '@/features/chat/components/modals/CreateCategoryModal';
import { BrowseChannelsModal } from '@/features/chat/components/modals/BrowseChannelsModal';
import { NewDmModal } from '@/features/chat/components/modals/NewDmModal';
import { ChannelSettingsModal } from '@/features/chat/components/modals/ChannelSettingsModal';
import '@/features/chat/styles/chat.css';

export function ChatPage() {
  const dispatch = useAppDispatch();
  const { channelId } = useParams<{ channelId: string }>();
  const initializedRef = useRef(false);

  const activeChannel = useAppSelector((state) =>
    state.chatChannels.channels.find(c => c.id === state.chatChannels.activeChannelId)
  );
  const threadPanelOpen = useAppSelector((state) => state.chatUi.threadPanelOpen);
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

  // Initialize chat data on mount
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;
    dispatch(initializeChat(channelId));
  }, [dispatch, channelId]);

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

  // Determine what to show in the right panel
  const rightPanel = threadPanelOpen && activeThreadId
    ? <ThreadPanel />
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
