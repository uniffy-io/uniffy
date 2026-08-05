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
  appendAgentThinking,
} from '@/features/chat/store/chatMessagesSlice';
import { fetchMembers, fetchThreadsInbox, fetchDrafts, markChannelRead, clearActiveChannelUnread } from '@/features/chat/store/chatThunks';
import { draftUpserted, draftRemoved, draftKey } from '@/features/chat/store/chatDraftsSlice';
import { draftClientSessionId } from '@/features/chat/api/draftSession';
import {
  addReactionToThreadMessage,
  removeReactionFromThreadMessage,
  appendThreadMessage,
  appendDeltaToThreadMessage,
} from '@/features/chat/store/chatThreadsSlice';
import { updateChannel, incrementUnreadCount, updateUnreadCounts, addChannel, removeChannel, touchChannelActivity, setMemberRole } from '@/features/chat/store/chatChannelsSlice';
import { isDocumentVisible } from '@/shared/utils/documentVisibility';
import { chatApi } from '@/features/chat/api/chatApi';
import { channelToPlain as apiChannelToPlain } from '@/features/chat/api/chatConverters';
import { ChatEventType, UserChatEventType } from '@uniffy/proto/chat/v1/chat_stream_pb';
import { ChannelRole } from '@uniffy/proto/chat/v1/chat_pb';
import { handleCallStreamEvent } from '@/features/calls/streamHandlers';
import { syncActiveCalls } from '@/features/calls/store/callsThunks';
import type { AppDispatch } from '@/app/store';
import type { StreamUserChatEventsResponse } from '@uniffy/proto/chat/v1/chat_stream_pb';

// At most one active stream connection per page.
let _activeController: AbortController | null = null;

const MAX_BACKOFF_MS = 30_000;
const INITIAL_BACKOFF_MS = 1_000;

/** Pull the authoritative channel row and fold it into the sidebar.
 *
 *  Lifecycle events carry an id, not a channel: hydrating through GetChannel
 *  gives every session the same row the channel list would have loaded,
 *  including the per-user fields (role, membership, agent retirement) a
 *  broadcast payload cannot carry.
 */
function hydrateChannel(
  organizationId: string,
  channelId: string,
  dispatch: AppDispatch,
  mode: 'add' | 'update',
): void {
  chatApi
    .getChannel({ organizationId, channelId })
    .then((res) => {
      if (!res.channel) return;
      const plain = channelToPlain(res.channel);
      dispatch(mode === 'add' ? addChannel(plain) : updateChannel(plain));
    })
    .catch(() => {});
}

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

  if (handleCallStreamEvent(ce, dispatch)) return;

  // Channel lifecycle applies to every session of every member, whatever
  // channel each one happens to be looking at.
  if (ce.eventType === ChatEventType.CHANNEL_CREATED) {
    hydrateChannel(organizationId, channelId, dispatch, 'add');
    return;
  }

  if (ce.eventType === ChatEventType.CHANNEL_UPDATED) {
    if (ce.payload.case === 'channelUpdated' && ce.payload.value?.isArchived) {
      dispatch(removeChannel(channelId));
      return;
    }
    hydrateChannel(organizationId, channelId, dispatch, 'update');
    return;
  }

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

  if (ce.eventType === ChatEventType.MEMBER_UPDATED) {
    if (ce.payload.case === 'member' && ce.payload.value) {
      const { userId, role } = ce.payload.value;
      dispatch(setMemberRole({
        channelId,
        userId,
        role: role === ChannelRole.OWNER ? 'OWNER' : role === ChannelRole.ADMIN ? 'ADMIN' : 'MEMBER',
      }));
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
        return;
      }
    }
    // Somebody else joined a channel this session already knows about: the
    // roster and member count moved, so refresh them wherever the user is.
    if (activeChannelId && channelId === activeChannelId) {
      dispatch(fetchMembers(activeChannelId));
    }
    hydrateChannel(organizationId, channelId, dispatch, 'update');
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
    hydrateChannel(organizationId, channelId, dispatch, 'update');
    return;
  }

  // Sidebar last-activity ordering: every new message bumps its channel,
  // whether or not that channel is the one on screen.
  if (ce.eventType === ChatEventType.MESSAGE_CREATED && ce.payload.case === 'message' && ce.payload.value) {
    const created = timestampToIso(ce.payload.value.createdAt);
    if (created) {
      dispatch(touchChannelActivity({
        channelId,
        at: created,
        isRoot: !ce.payload.value.rootId,
      }));
    }
  }

  if (!activeChannelId || channelId !== activeChannelId) return;

  switch (ce.eventType) {
    case ChatEventType.MESSAGE_CREATED: {
      if (ce.payload.case === 'message' && ce.payload.value) {
        const msg = messageToPlain(ce.payload.value);
        // An agent emits several rows mid-turn (tool calls/results, the final
        // placeholder); its working indicator is owned by AGENT_TYPING
        // start/stop, so only a human's own message clears their typing entry.
        if (msg.senderType !== 'AGENT') {
          dispatch(clearTypingUser({ channelId: activeChannelId, userId: msg.senderId }));
        }
        if (msg.rootId) {
          dispatch(appendThreadMessage({ rootMessageId: msg.rootId, message: msg }));
        } else {
          dispatch(appendMessage({ channelId: activeChannelId, message: msg }));
          // Viewing this channel live: mark the new message read so it never
          // surfaces as unread. Unread is time-based (last_read_at = now), so
          // the real id clears the just-arrived message too. Skip own sends;
          // thread replies do not count toward the channel badge.
          if (msg.senderId !== currentUserId && isDocumentVisible()) {
            dispatch(updateUnreadCounts([{ channelId: activeChannelId, unreadCount: 0, mentionCount: 0 }]));
            dispatch(markChannelRead({ channelId: activeChannelId, lastReadMessageId: msg.id }));
          }
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
              hasUnread: existing?.thread?.hasUnread ?? false,
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
    case ChatEventType.AGENT_THINKING_DELTA: {
      if (ce.payload.case === 'agentThinkingDelta' && ce.payload.value) {
        const { messageId, blockId, delta, sequence, final, elapsedMs } = ce.payload.value;
        dispatch(appendAgentThinking({
          messageId,
          blockId,
          delta,
          sequence: Number(sequence),
          final,
          elapsedMs: Number(elapsedMs),
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
  const channelIds = useAppSelector((state) => state.chatChannels.ids);

  // Refs keep the effect from re-running on channel switch or user change.
  const channelIdRef = useRef(activeChannelId);
  channelIdRef.current = activeChannelId;
  const userIdRef = useRef(currentUserId);
  userIdRef.current = currentUserId;
  const byId = useAppSelector((state) => state.chatMessages.byId);
  const channelIdsRef = useRef(new Set<string>());
  channelIdsRef.current = new Set(channelIds);
  const byIdRef = useRef(byId);
  byIdRef.current = byId;
  const fetchingChannelsRef = useRef(new Set<string>());

  // Returning to the tab clears the badge the hidden-tab stream handlers left
  // on the active channel (see clearActiveChannelUnread).
  useEffect(() => {
    const onVisible = () => {
      if (isDocumentVisible()) {
        dispatch(clearActiveChannelUnread());
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [dispatch]);

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

        let sawEvent = false;
        try {
          const stream = chatStreamApi.streamUserChatEvents(
            { organizationId: organizationId! },
            controller.signal,
          );

          // The stream is a latency optimization, not the source of truth:
          // events published while disconnected are gone. Resync call and draft
          // state on every (re)connect (keeps initial load and reconnect recovery
          // prompt); both thunks swallow their own failures. The escalating
          // backoff below bounds this to one sync per connect attempt during an
          // outage.
          void dispatch(syncActiveCalls());
          void dispatch(fetchDrafts());

          for await (const event of stream) {
            if (!mounted) break;

            if (!sawEvent) {
              // Reset the backoff only once the stream actually delivers an event
              // (a real event or the 30s heartbeat). An open-then-drop connection
              // - HTTP up, pub/sub down - never reaches here, so it keeps
              // escalating instead of resetting to 1s and looping ListActiveCalls.
              sawEvent = true;
              backoff = INITIAL_BACKOFF_MS;
            }

            switch (event.eventType) {
              case UserChatEventType.UNREAD_COUNT_CHANGED: {
                if (event.payload.case === 'unreadCount' && event.payload.value) {
                  const p = event.payload.value;

                  // Channel open and window focused: the user is reading it now.
                  // Keep the badge clear and advance the read cursor instead of
                  // surfacing a phantom unread (which also cascades the chat
                  // notification read, so the bell does not accumulate).
                  if (p.channelId === channelIdRef.current && isDocumentVisible()) {
                    // Reading it live: keep the badge clear. The MESSAGE_CREATED
                    // handler advances the server read cursor with the real id.
                    dispatch(updateUnreadCounts([{ channelId: p.channelId, unreadCount: 0, mentionCount: 0 }]));
                    break;
                  }

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
                  if (p.channelId === channelIdRef.current && isDocumentVisible()) {
                    dispatch(updateUnreadCounts([{ channelId: p.channelId, unreadCount: 0, mentionCount: 0 }]));
                    break;
                  }
                  dispatch(incrementUnreadCount({
                    channelId: p.channelId,
                    mentionCount: 1,
                  }));
                }
                break;
              }
              case UserChatEventType.DRAFT_CHANGED: {
                if (event.payload.case === 'draftChanged' && event.payload.value) {
                  const p = event.payload.value;
                  // Skip our own echo; applying it would fight the local composer.
                  if (p.clientSessionId === draftClientSessionId) break;
                  if (p.deleted) {
                    dispatch(draftRemoved(draftKey(p.channelId, p.rootMessageId)));
                  } else {
                    dispatch(draftUpserted({
                      channelId: p.channelId,
                      rootMessageId: p.rootMessageId ?? null,
                      content: p.content,
                      updatedAt: timestampToIso(p.updatedAt) ?? new Date().toISOString(),
                    }));
                  }
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
