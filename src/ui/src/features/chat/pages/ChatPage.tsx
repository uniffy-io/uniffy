/**
 * ChatPage - Main page component for the Chat feature.
 *
 * Handles routing, data initialization, and wires up the 3-panel layout.
 * Supports split-screen mode for viewing two channels side by side.
 * Uses mock data for now - will connect to backend API later.
 */

import { useEffect, useCallback } from 'react';
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
import { setChannels, setActiveChannel, setChannelMembers } from '@/features/chat/store/chatChannelsSlice';
import { setMessages, setUnreadSeparator } from '@/features/chat/store/chatMessagesSlice';
import { setFollowedThreads, setThreadsInbox } from '@/features/chat/store/chatThreadsSlice';
import {
  toggleSidebar,
  deactivateSplit,
  setFocusedPane,
} from '@/features/chat/store/chatUiSlice';
import { clearSplitChannel } from '@/features/chat/store/chatChannelsSlice';
import '@/features/chat/styles/chat.css';
import { MOCK_CHANNELS } from '@/features/chat/mock/mockChannels';
import { MOCK_CHANNEL_MEMBERS } from '@/features/chat/mock/mockMembers';
import { getMessagesForChannel } from '@/features/chat/mock/mockMessages';
import { MOCK_THREADS_INBOX, MOCK_FOLLOWED_THREADS } from '@/features/chat/mock/mockThreads';

export function ChatPage() {
  const dispatch = useAppDispatch();
  const { channelId } = useParams<{ channelId: string }>();

  const activeChannelId = useAppSelector((state) => state.chatChannels.activeChannelId);
  const activeChannel = useAppSelector((state) =>
    state.chatChannels.channels.find(c => c.id === state.chatChannels.activeChannelId)
  );
  const threadPanelOpen = useAppSelector((state) => state.chatUi.threadPanelOpen);
  const activeThreadId = useAppSelector((state) => state.chatThreads.activeThreadId);
  const splitActive = useAppSelector((state) => state.chatUi.splitActive);
  const splitChannelId = useAppSelector((state) => state.chatChannels.splitChannelId);
  const focusedPane = useAppSelector((state) => state.chatUi.focusedPane);
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

  // Initialize mock data on mount
  useEffect(() => {
    dispatch(setChannels(MOCK_CHANNELS));
    dispatch(setFollowedThreads(MOCK_FOLLOWED_THREADS));
    dispatch(setThreadsInbox(MOCK_THREADS_INBOX));

    // Load members for all channels
    for (const [chId, members] of Object.entries(MOCK_CHANNEL_MEMBERS)) {
      dispatch(setChannelMembers({ channelId: chId, members }));
    }
  }, [dispatch]);

  // Handle channel selection from URL
  useEffect(() => {
    if (channelId && channelId !== activeChannelId) {
      dispatch(setActiveChannel(channelId));
    } else if (!channelId && !activeChannelId && MOCK_CHANNELS.length > 0) {
      // Default to #general (first channel)
      dispatch(setActiveChannel(MOCK_CHANNELS[0].id));
    }
  }, [channelId, activeChannelId, dispatch]);

  // Load messages when active channel changes
  useEffect(() => {
    if (activeChannelId) {
      const messages = getMessagesForChannel(activeChannelId);
      dispatch(setMessages({ channelId: activeChannelId, messages }));

      // Set unread separator on a message for demo purposes
      if (messages.length > 5) {
        dispatch(setUnreadSeparator({
          channelId: activeChannelId,
          messageId: messages[messages.length - 3].id,
        }));
      }
    }
  }, [activeChannelId, dispatch]);

  // Load messages for split channel when it changes
  useEffect(() => {
    if (splitChannelId) {
      const messages = getMessagesForChannel(splitChannelId);
      dispatch(setMessages({ channelId: splitChannelId, messages }));
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
    </>
  );
}
