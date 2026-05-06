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
import { getChannelDisplayName } from '@/features/chat/utils/channelDisplay';
import { sendMessage, sendTyping, editMessage } from '@/features/chat/store/chatThunks';
import { updateMessage } from '@/features/chat/store/chatMessagesSlice';
import { selectReplyToMessage, clearReplyToMessage, selectEditingMessage, clearEditingMessage, setEditingMessage } from '@/features/chat/store/chatUiSlice';
import { selectMessagesForChannel } from '@/features/chat/store/chatMessagesSlice';
import { attachmentsApi } from '@/features/attachments';
import { ContentType } from '@uniffy/proto/common/v1/common_pb';

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
  const organizationId = useAppSelector((state) => state.auth.currentOrganizationId);

  const activeChannel = useAppSelector((state) =>
    state.chatChannels.channels.find((c) => c.id === effectiveChannelId),
  );
  const replyToMessage = useAppSelector(selectReplyToMessage);
  const editingMessage = useAppSelector(selectEditingMessage);
  const currentUserId = useAppSelector((state) => state.auth.user?.id);
  const channelMessages = useAppSelector((state) =>
    effectiveChannelId ? selectMessagesForChannel(state, effectiveChannelId) : null,
  );

  const handleSend = useCallback(
    async (content: string, fileIds: string[]) => {
      if (!activeChannel || !effectiveChannelId) return;
      const result = await dispatch(sendMessage({
        channelId: effectiveChannelId,
        content: content || '',
        replyToId: replyToMessage?.id,
      })).unwrap();
      dispatch(clearReplyToMessage());

      if (fileIds.length > 0 && organizationId && result.id) {
        const attachResults = await Promise.all(
          fileIds.map((fileId) =>
            attachmentsApi.attachFile({
              organizationId,
              sourceFileId: fileId,
              contentType: ContentType.CHAT_MESSAGE,
              contentId: result.id,
            }).catch((err) => {
              console.error('[ChannelView] Failed to attach file:', err);
              return null;
            })
          )
        );

        const attachments = attachResults
          .filter((r): r is NonNullable<typeof r> => r !== null && !!r.attachment)
          .map((r) => ({
            id: r.attachment!.id,
            fileId: r.attachment!.fileId,
            filename: r.attachment!.filename,
            mimeType: r.attachment!.mimeType,
            sizeBytes: Number(r.attachment!.sizeBytes),
          }));

        if (attachments.length > 0) {
          dispatch(updateMessage({
            channelId: effectiveChannelId,
            message: { ...result, attachments },
          }));
        }
      }
    },
    [activeChannel, effectiveChannelId, replyToMessage, dispatch, organizationId],
  );

  const handleCancelReply = useCallback(() => {
    dispatch(clearReplyToMessage());
  }, [dispatch]);

  const handleEdit = useCallback(async (content: string) => {
    if (!editingMessage) return;
    await dispatch(editMessage({
      channelId: editingMessage.channelId,
      messageId: editingMessage.id,
      content,
    }));
    dispatch(clearEditingMessage());
  }, [editingMessage, dispatch]);

  const handleCancelEdit = useCallback(() => {
    dispatch(clearEditingMessage());
  }, [dispatch]);

  const handleEditLast = useCallback(() => {
    if (!effectiveChannelId || !currentUserId || !channelMessages) return;
    for (let i = channelMessages.length - 1; i >= 0; i--) {
      const msg = channelMessages[i];
      if (msg.senderId === currentUserId && !msg.isDeleted) {
        dispatch(setEditingMessage({
          id: msg.id,
          channelId: effectiveChannelId,
          content: msg.content,
        }));
        return;
      }
    }
  }, [effectiveChannelId, currentUserId, channelMessages, dispatch]);

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

  const resolvedName = getChannelDisplayName(activeChannel);
  const channelDisplayName =
    activeChannel.channelType === 'DIRECT' || activeChannel.channelType === 'GROUP_DM'
      ? resolvedName
      : `#${resolvedName}`;

  return (
    <div
      className="flex flex-col h-full"
      style={{
        // Subtle polish: a faint primary-tinted spotlight in the top-right
        // and a complementary cool wash in the bottom-left. Both alphas are
        // tiny (4-6%) so the overall background still reads as bg-background
        // but the canvas gains depth instead of feeling like a flat slab.
        backgroundImage:
          'radial-gradient(ellipse 90% 60% at 100% 0%, hsl(var(--primary) / 0.03), transparent 60%), radial-gradient(ellipse 80% 60% at 0% 100%, hsl(var(--ring) / 0.02), transparent 60%)',
      }}
      onMouseDown={onFocus}
      data-testid="chat-channel-view"
      data-channel-id={effectiveChannelId ?? ''}
    >
      <ChannelHeader channelId={effectiveChannelId ?? undefined} showCloseButton={showCloseButton} onClose={onClose} />
      <MessageList channelId={effectiveChannelId ?? undefined} />
      <MessageCompose
        channelName={channelDisplayName}
        organizationId={organizationId ?? undefined}
        onSend={handleSend}
        onTyping={handleTyping}
        replyTo={replyToMessage}
        onCancelReply={handleCancelReply}
        editingMessage={editingMessage}
        onSaveEdit={handleEdit}
        onCancelEdit={handleCancelEdit}
        onEditLast={handleEditLast}
      />
    </div>
  );
}
