/** One persistent stream per session; channel filtering happens client-side against the active channelId. */

import { useEffect, useRef } from 'react';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { chatStreamApi } from '@/features/chat/api/chatApi';
import { messageToPlain, channelToPlain, timestampToIso } from '@/features/chat/api/chatConverters';
import {
  appendMessage,
  updateMessage,
  deleteMessage,
  removeMessage,
  setTypingUser,
  clearTypingUser,
  setAgentTyping,
  clearAgentTyping,
  addReactionToMessage,
  removeReactionFromMessage,
  appendDelta,
} from '@/features/chat/store/chatMessagesSlice';
import { fetchMembers, fetchThreadsInbox } from '@/features/chat/store/chatThunks';
import {
  addReactionToThreadMessage,
  removeReactionFromThreadMessage,
  appendThreadMessage,
  appendDeltaToThreadMessage,
} from '@/features/chat/store/chatThreadsSlice';
import { updateChannel, incrementUnreadCount, addChannel, removeChannel } from '@/features/chat/store/chatChannelsSlice';
import { chatApi } from '@/features/chat/api/chatApi';
import { channelToPlain as apiChannelToPlain } from '@/features/chat/api/chatConverters';
import { ChatEventType, UserChatEventType } from '@uniffy/proto/chat/v1/chat_stream_pb';
import type { AppDispatch } from '@/app/store';
import type { StreamUserChatEventsResponse } from '@uniffy/proto/chat/v1/chat_stream_pb';

// At most one active stream connection per page.
let _activeController: AbortController | null = null;

const MAX_BACKOFF_MS = 30_000;
const INITIAL_BACKOFF_MS = 1_000;

function handleChannelEvent(
  event: StreamUserChatEventsResponse,
  activeChannelId: string | null,
  currentUserId: string,
  organizationId: string,
  dispatch: AppDispatch,
  getMessageById: (id: string) => import('@/features/chat/types').ChatMessage | undefined,
): void {
  if (event.payload.case !== 'channelEvent' || !event.payload.value) return;
  const ce = event.payload.value;
  const channelId = ce.channelId;

  // Member events apply globally, not just the active channel.
  if (ce.eventType === ChatEventType.MEMBER_JOINED) {
    if (ce.payload.case === 'member' && ce.payload.value) {
      const joinedUserId = ce.payload.value.userId;
      if (joinedUserId === currentUserId) {
        chatApi
          .getChannel({ organizationId, channelId })
          .then((res) => {
            if (res.channel) {
              const plain = channelToPlain(res.channel);
              plain.unreadCount = 1;
              dispatch(addChannel(plain));
            }
          })
          .catch(() => {});
      }
    }
    if (activeChannelId && channelId === activeChannelId) {
      dispatch(fetchMembers(activeChannelId));
    }
    return;
  }

  if (ce.eventType === ChatEventType.MEMBER_LEFT) {
    if (ce.payload.case === 'member' && ce.payload.value) {
      const leftUserId = ce.payload.value.userId;
      if (leftUserId === currentUserId) {
        dispatch(removeChannel(channelId));
        return;
      }
    }
    if (activeChannelId && channelId === activeChannelId) {
      dispatch(fetchMembers(activeChannelId));
    }
    return;
  }

  if (ce.eventType === ChatEventType.MEMBERS_ADDED) {
    if (ce.payload.case === 'membersChanged' && ce.payload.value) {
      const ids = ce.payload.value.userIds || [];
      if (ids.includes(currentUserId)) {
        chatApi
          .getChannel({ organizationId, channelId })
          .then((res) => {
            if (res.channel) {
              const plain = channelToPlain(res.channel);
              plain.unreadCount = 1;
              dispatch(addChannel(plain));
            }
          })
          .catch(() => {});
      }
    }
    if (activeChannelId && channelId === activeChannelId) {
      dispatch(fetchMembers(activeChannelId));
    }
    return;
  }

  if (ce.eventType === ChatEventType.MEMBERS_REMOVED) {
    if (ce.payload.case === 'membersChanged' && ce.payload.value) {
      const ids = ce.payload.value.userIds || [];
      if (ids.includes(currentUserId)) {
        dispatch(removeChannel(channelId));
        return;
      }
    }
    if (activeChannelId && channelId === activeChannelId) {
      dispatch(fetchMembers(activeChannelId));
    }
    return;
  }

  if (!activeChannelId || channelId !== activeChannelId) return;

  switch (ce.eventType) {
    case ChatEventType.MESSAGE_CREATED: {
      if (ce.payload.case === 'message' && ce.payload.value) {
        const msg = messageToPlain(ce.payload.value);
        dispatch(clearTypingUser({ channelId: activeChannelId, userId: msg.senderId }));
        if (msg.rootId) {
          dispatch(appendThreadMessage({ rootMessageId: msg.rootId, message: msg }));
        } else {
          dispatch(appendMessage({ channelId: activeChannelId, message: msg }));
        }
      }
      break;
    }
    case ChatEventType.MESSAGE_UPDATED: {
      if (ce.payload.case === 'message' && ce.payload.value) {
        dispatch(updateMessage({ channelId: activeChannelId, message: messageToPlain(ce.payload.value) }));
      }
      break;
    }
    case ChatEventType.MESSAGE_DELETED: {
      if (ce.payload.case === 'messageDeleted' && ce.payload.value) {
        dispatch(deleteMessage({ channelId: activeChannelId, messageId: ce.payload.value.messageId }));
      }
      break;
    }
    case ChatEventType.CHANNEL_UPDATED: {
      if (ce.payload.case === 'channelUpdated' && ce.payload.value) {
        const updated = ce.payload.value;
        if (updated.isArchived) {
          dispatch(removeChannel(updated.id));
        } else {
          dispatch(updateChannel(channelToPlain(updated)));
        }
      }
      break;
    }
    case ChatEventType.THREAD_UPDATED: {
      if (ce.payload.case === 'threadUpdated' && ce.payload.value) {
        const p = ce.payload.value;
        const existing = getMessageById(p.rootMessageId);
        const existingParticipants = existing?.thread?.participantIds ?? [];
        const updatedParticipants = existingParticipants.includes(p.latestParticipantId)
          ? existingParticipants
          : [...existingParticipants, p.latestParticipantId];
        dispatch(updateMessage({
          channelId: activeChannelId,
          message: {
            id: p.rootMessageId,
            channelId: activeChannelId,
            thread: {
              replyCount: p.replyCount,
              lastReplyAt: timestampToIso(p.lastReplyAt) ?? new Date().toISOString(),
              participantIds: updatedParticipants,
            },
          } as never,
        }));
      }
      break;
    }
    case ChatEventType.TYPING_STARTED: {
      if (ce.payload.case === 'typing' && ce.payload.value) {
        dispatch(setTypingUser({
          channelId: activeChannelId,
          userId: ce.payload.value.userId,
          displayName: ce.payload.value.displayName,
        }));
      }
      break;
    }
    case ChatEventType.TYPING_STOPPED: {
      if (ce.payload.case === 'typing' && ce.payload.value) {
        dispatch(clearTypingUser({ channelId: activeChannelId, userId: ce.payload.value.userId }));
      }
      break;
    }
    case ChatEventType.REACTION_ADDED: {
      if (ce.payload.case === 'reaction' && ce.payload.value) {
        const { messageId, emoji, userId } = ce.payload.value;
        dispatch(addReactionToMessage({
          channelId: activeChannelId,
          messageId,
          emoji,
          userId,
          currentUserId,
        }));
        dispatch(addReactionToThreadMessage({
          messageId,
          emoji,
          userId,
          currentUserId,
        }));
      }
      break;
    }
    case ChatEventType.REACTION_REMOVED: {
      if (ce.payload.case === 'reaction' && ce.payload.value) {
        const { messageId, emoji, userId } = ce.payload.value;
        dispatch(removeReactionFromMessage({
          channelId: activeChannelId,
          messageId,
          emoji,
          userId,
          currentUserId,
        }));
        dispatch(removeReactionFromThreadMessage({
          messageId,
          emoji,
          userId,
          currentUserId,
        }));
      }
      break;
    }
    case ChatEventType.AGENT_TYPING: {
      if (ce.payload.case === 'agentTyping' && ce.payload.value) {
        const { agentId, displayName, started, rootId } = ce.payload.value;
        if (started) {
          dispatch(setAgentTyping({
            channelId: activeChannelId,
            agentId,
            displayName,
            rootId: rootId || undefined,
          }));
        } else {
          dispatch(clearAgentTyping({
            channelId: activeChannelId,
            agentId,
            rootId: rootId || undefined,
          }));
        }
      }
      break;
    }
    case ChatEventType.AGENT_TOKEN_DELTA: {
      if (ce.payload.case === 'agentTokenDelta' && ce.payload.value) {
        const { messageId, delta, sequence, final } = ce.payload.value;
        // Placeholder lives in channel store OR thread bucket; dispatch to both, the non-owner no-ops.
        const payload = {
          channelId: activeChannelId,
          messageId,
          delta,
          sequence: Number(sequence),
          final,
        };
        dispatch(appendDelta(payload));
        dispatch(appendDeltaToThreadMessage({
          messageId,
          delta,
          sequence: Number(sequence),
          final,
        }));
      }
      break;
    }
    case ChatEventType.AGENT_TOOL_CALL: {
      // Redundant with the MESSAGE_CREATED companion the backend emits for each tool row.
      break;
    }
    case ChatEventType.AGENT_CONFIRMATION_REQUESTED: {
      if (ce.payload.case === 'agentConfirmationRequested' && ce.payload.value) {
        const p = ce.payload.value;
        const expiresIso = p.expiresAt ? timestampToIso(p.expiresAt) : null;
        const synthetic: import('@/features/chat/types').ChatMessage = {
          id: p.requestId,
          channelId: activeChannelId,
          senderId: p.agentId,
          senderType: 'AGENT',
          content: '',
          rootId: null,
          replyToId: null,
          editedAt: null,
          isDeleted: false,
          isPinned: false,
          metadata: {
            kind: 'confirmation_request',
            agent_id: p.agentId,
            request_id: p.requestId,
            message_id: p.messageId,
            tool_name: p.toolName,
            args_preview: p.argsPreview,
            actor_user_id: p.actorUserId,
            ...(expiresIso ? { expires_at: expiresIso } : {}),
          },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          reactions: [],
        };
        dispatch(appendMessage({ channelId: activeChannelId, message: synthetic }));
      }
      break;
    }
    case ChatEventType.AGENT_CONFIRMATION_RESOLVED: {
      if (ce.payload.case === 'agentConfirmationResolved' && ce.payload.value) {
        const { requestId } = ce.payload.value;
        dispatch(removeMessage({ channelId: activeChannelId, messageId: requestId }));
      }
      break;
    }
  }
}

function usePersistentChatStream() {
  const dispatch = useAppDispatch();
  const organizationId = useAppSelector((state) => state.auth.currentOrganizationId);
  const activeChannelId = useAppSelector((state) => state.chatChannels.activeChannelId);
  const currentUserId = useAppSelector((state) => state.auth.user?.id ?? '');
  const channels = useAppSelector((state) => state.chatChannels.channels);

  // Refs keep the effect from re-running on channel switch or user change.
  const channelIdRef = useRef(activeChannelId);
  channelIdRef.current = activeChannelId;
  const userIdRef = useRef(currentUserId);
  userIdRef.current = currentUserId;
  const byId = useAppSelector((state) => state.chatMessages.byId);
  const channelIdsRef = useRef(new Set<string>());
  channelIdsRef.current = new Set(channels.map((c) => c.id));
  const byIdRef = useRef(byId);
  byIdRef.current = byId;
  const fetchingChannelsRef = useRef(new Set<string>());

  useEffect(() => {
    if (!organizationId) return;

    _activeController?.abort();

    let backoff = INITIAL_BACKOFF_MS;
    let mounted = true;
    let controller: AbortController;

    async function connect() {
      while (mounted) {
        controller = new AbortController();
        _activeController = controller;

        try {
          const stream = chatStreamApi.streamUserChatEvents(
            { organizationId: organizationId! },
            controller.signal,
          );

          backoff = INITIAL_BACKOFF_MS;

          for await (const event of stream) {
            if (!mounted) break;

            switch (event.eventType) {
              case UserChatEventType.UNREAD_COUNT_CHANGED: {
                if (event.payload.case === 'unreadCount' && event.payload.value) {
                  const p = event.payload.value;

                  // Unknown channel (e.g. new DM): fetch and add it.
                  if (
                    !channelIdsRef.current.has(p.channelId) &&
                    !fetchingChannelsRef.current.has(p.channelId) &&
                    organizationId
                  ) {
                    fetchingChannelsRef.current.add(p.channelId);
                    chatApi
                      .getChannel({ organizationId, channelId: p.channelId })
                      .then((res) => {
                        if (res.channel) {
                          const plain = apiChannelToPlain(res.channel);
                          plain.unreadCount = 1;
                          if (p.mentionCount > 0) plain.mentionCount = p.mentionCount;
                          dispatch(addChannel(plain));
                        }
                      })
                      .catch(() => {
                        // Non-fatal; appears on next full refresh.
                      })
                      .finally(() => {
                        fetchingChannelsRef.current.delete(p.channelId);
                      });
                  } else {
                    dispatch(incrementUnreadCount({
                      channelId: p.channelId,
                      mentionCount: p.mentionCount > 0 ? p.mentionCount : undefined,
                    }));
                  }
                }
                break;
              }
              case UserChatEventType.CHANNEL_EVENT: {
                handleChannelEvent(event, channelIdRef.current, userIdRef.current, organizationId!, dispatch, (id) => byIdRef.current[id]);
                break;
              }
              case UserChatEventType.THREAD_ACTIVITY: {
                dispatch(fetchThreadsInbox());
                break;
              }
              case UserChatEventType.MENTION_RECEIVED: {
                if (event.payload.case === 'mentionReceived' && event.payload.value) {
                  const p = event.payload.value;
                  dispatch(incrementUnreadCount({
                    channelId: p.channelId,
                    mentionCount: 1,
                  }));
                }
                break;
              }
              case UserChatEventType.HEARTBEAT:
                break;
            }
          }
        } catch {
          // Connection failed, dropped, or aborted.
        }

        if (!mounted) break;

        const jitter = Math.random() * 1000;
        await new Promise(resolve => setTimeout(resolve, backoff + jitter));
        backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
      }
    }

    connect();

    return () => {
      mounted = false;
      _activeController?.abort();
      if (_activeController === controller!) {
        _activeController = null;
      }
    };
  }, [organizationId, dispatch]);
}

/** Mount once at the app level to maintain the persistent chat stream. */
export function ChatStreamProvider() {
  usePersistentChatStream();
  return null;
}
