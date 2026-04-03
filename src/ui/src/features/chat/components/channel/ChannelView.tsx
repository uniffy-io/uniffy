/**
 * ChannelView - Main channel content area.
 *
 * Contains the channel header, message list, typing indicator, and compose box.
 * Wires together ChannelHeader, MessageList, and MessageCompose.
 */

import { useCallback, useRef } from 'react';
import { Hash } from '@phosphor-icons/react';
import { useAppSelector, useAppDispatch } from '@/app/hooks';
import { ChannelHeader } from '@/features/chat/components/channel/ChannelHeader';
import { MessageList } from '@/features/chat/components/channel/MessageList';
import { MessageCompose } from '@/features/chat/components/compose/MessageCompose';
import { sendMessage, sendTyping } from '@/features/chat/store/chatThunks';
import { selectReplyToMessage, clearReplyToMessage } from '@/features/chat/store/chatUiSlice';

const TYPING_THROTTLE_MS = 3000;

interface ChannelViewProps {
  channelId?: string;
  onFocus?: () => void;
  showCloseButton?: boolean;
  onClose?: () => void;
}

export function ChannelView({ channelId: channelIdProp, onFocus, showCloseButton, onClose }: ChannelViewProps) {
  const dispatch = useAppDispatch();
  const lastTypingSentRef = useRef(0);

  // Use prop if provided, otherwise read from Redux
  const activeChannelIdFromRedux = useAppSelector((state) => state.chatChannels.activeChannelId);
  const effectiveChannelId = channelIdProp ?? activeChannelIdFromRedux;

  const activeChannel = useAppSelector((state) =>
    state.chatChannels.channels.find((c) => c.id === effectiveChannelId),
  );
  const replyToMessage = useAppSelector(selectReplyToMessage);

  const handleSend = useCallback(
    (content: string) => {
      if (!activeChannel || !effectiveChannelId) return;
      dispatch(sendMessage({
        channelId: effectiveChannelId,
        content,
        replyToId: replyToMessage?.id,
      }));
      dispatch(clearReplyToMessage());
    },
    [activeChannel, effectiveChannelId, replyToMessage, dispatch],
  );

  const handleCancelReply = useCallback(() => {
    dispatch(clearReplyToMessage());
  }, [dispatch]);

  const handleTyping = useCallback(() => {
    if (!effectiveChannelId) return;
    const now = Date.now();
    if (now - lastTypingSentRef.current < TYPING_THROTTLE_MS) return;
    lastTypingSentRef.current = now;
    dispatch(sendTyping(effectiveChannelId));
  }, [effectiveChannelId, dispatch]);

  if (!activeChannel) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        <div className="text-center">
          <Hash size={48} className="mx-auto mb-3 text-muted-foreground/30" />
          <p className="text-lg font-semibold text-foreground">Welcome to Chat</p>
          <p className="text-sm mt-1">Select a channel from the sidebar to start messaging.</p>
        </div>
      </div>
    );
  }

  const channelDisplayName =
    activeChannel.channelType === 'DIRECT' || activeChannel.channelType === 'GROUP_DM'
      ? activeChannel.name
      : `#${activeChannel.name}`;

  return (
    <div className="flex flex-col h-full" onMouseDown={onFocus}>
      <ChannelHeader channelId={effectiveChannelId ?? undefined} showCloseButton={showCloseButton} onClose={onClose} />
      <MessageList channelId={effectiveChannelId ?? undefined} />
      <MessageCompose
        channelName={channelDisplayName}
        onSend={handleSend}
        onTyping={handleTyping}
        replyTo={replyToMessage}
        onCancelReply={handleCancelReply}
      />
    </div>
  );
}
