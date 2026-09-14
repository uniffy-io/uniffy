/** One persistent stream per session; channel filtering happens client-side against the live channels (both panes and the open thread's channel). */

import { useEffect, useRef } from "react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { chatStreamApi } from "@/features/chat/api/chatApi";
import { messageToPlain, timestampToIso } from "@/features/chat/api/chatConverters";
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
  restrictForwardsFromChannel,
  restrictForwardsFromMessage,
  clearChannelMessages,
} from "@/features/chat/store/chatMessagesSlice";
import {
  fetchMembers,
  fetchChannel,
  fetchChannels,
  fetchThreadsInbox,
  fetchDrafts,
  fetchChatPolicy,
  markChannelRead,
  clearActiveChannelUnread,
} from "@/features/chat/store/chatThunks";
import { draftUpserted, draftRemoved, draftKey } from "@/features/chat/store/chatDraftsSlice";
import { draftClientSessionId } from "@/features/chat/api/draftSession";
import {
  addReactionToThreadMessage,
  removeReactionFromThreadMessage,
  appendThreadMessage,
  appendDeltaToThreadMessage,
  restrictThreadForwardsFromChannel,
  restrictThreadForwardsFromMessage,
  selectActiveThreadChannelId,
} from "@/features/chat/store/chatThreadsSlice";
import {
  incrementUnreadCount,
  updateUnreadCounts,
  removeChannel,
  touchChannelActivity,
  setMemberRole,
  invalidateArchivedChannels,
  invalidateChannel,
} from "@/features/chat/store/chatChannelsSlice";
import { isDocumentVisible } from "@/shared/utils/documentVisibility";
import { ChatEventType, UserChatEventType } from "@uniffy/proto/chat/v1/chat_stream_pb";
import { ChannelRole } from "@uniffy/proto/chat/v1/chat_pb";
import { handleCallStreamEvent } from "@/features/calls/streamHandlers";
import { syncActiveCalls } from "@/features/calls/store/callsThunks";
import type { AppDispatch } from "@/app/store";
import type { StreamUserChatEventsResponse } from "@uniffy/proto/chat/v1/chat_stream_pb";

// At most one active stream connection per page.
let _activeController: AbortController | null = null;

const MAX_BACKOFF_MS = 30_000;
const INITIAL_BACKOFF_MS = 1_000;

function hydrateChannel(channelId: string, dispatch: AppDispatch): void {
  void dispatch(fetchChannel(channelId));
}

/**
 * Channels whose events must land in the store live: the left pane, the split
 * pane, and the channel of the open thread (which can belong to neither pane
 * when opened from the inbox). Only panes take root messages; the thread's
 * channel takes thread replies, thread counters, and per-message patches.
 */
interface LiveChannels {
  activeChannelId: string | null;
  splitChannelId: string | null;
  threadChannelId: string | null;
  /** Channels the user marked unread; auto-mark-read stays off until reopened. */
  manualUnread: Record<string, true>;
}

function handleChannelEvent(
  event: StreamUserChatEventsResponse,
  live: LiveChannels,
  currentUserId: string,
  dispatch: AppDispatch,
  getMessageById: (id: string) => import("@/features/chat/types").ChatMessage | undefined,
): void {
  if (event.payload.case !== "channelEvent" || !event.payload.value) return;
  const ce = event.payload.value;
  const channelId = ce.channelId;
  const isPane = channelId === live.activeChannelId || channelId === live.splitChannelId;
  const isLive = isPane || channelId === live.threadChannelId;

  if (handleCallStreamEvent(ce, dispatch)) return;

  // Channel lifecycle applies to every session of every member, whatever
  // channel each one happens to be looking at.
  if (ce.eventType === ChatEventType.CHANNEL_CREATED) {
    hydrateChannel(channelId, dispatch);
    return;
  }

  if (ce.eventType === ChatEventType.CHANNEL_UPDATED) {
    dispatch(invalidateChannel(channelId));
    dispatch(invalidateArchivedChannels({}));
    if (ce.payload.case === "channelUpdated" && ce.payload.value?.isArchived) {
      dispatch(restrictForwardsFromChannel(channelId));
      dispatch(restrictThreadForwardsFromChannel(channelId));
      dispatch(clearChannelMessages(channelId));
      dispatch(removeChannel(channelId));
      return;
    }
    hydrateChannel(channelId, dispatch);
    return;
  }

  // Member events apply globally, not just the active channel.
  if (ce.eventType === ChatEventType.MEMBER_JOINED) {
    if (ce.payload.case === "member" && ce.payload.value) {
      const joinedUserId = ce.payload.value.userId;
      if (joinedUserId === currentUserId) {
        hydrateChannel(channelId, dispatch);
      }
    }
    if (isPane) {
      dispatch(fetchMembers(channelId));
    }
    return;
  }

  if (ce.eventType === ChatEventType.MEMBER_LEFT) {
    if (ce.payload.case === "member" && ce.payload.value) {
      const leftUserId = ce.payload.value.userId;
      if (leftUserId === currentUserId) {
        dispatch(restrictForwardsFromChannel(channelId));
        dispatch(restrictThreadForwardsFromChannel(channelId));
        dispatch(clearChannelMessages(channelId));
        dispatch(removeChannel(channelId));
        return;
      }
    }
    if (isPane) {
      dispatch(fetchMembers(channelId));
    }
    return;
  }

  if (ce.eventType === ChatEventType.MEMBER_UPDATED) {
    if (ce.payload.case === "member" && ce.payload.value) {
      const { userId, role } = ce.payload.value;
      dispatch(
        setMemberRole({
          channelId,
          userId,
          role:
            role === ChannelRole.OWNER ? "OWNER" : role === ChannelRole.ADMIN ? "ADMIN" : "MEMBER",
        }),
      );
    }
    return;
  }

  if (ce.eventType === ChatEventType.MEMBERS_ADDED) {
    if (ce.payload.case === "membersChanged" && ce.payload.value) {
      const ids = ce.payload.value.userIds || [];
      if (ids.includes(currentUserId)) {
        hydrateChannel(channelId, dispatch);
        return;
      }
    }
    // Somebody else joined a channel this session already knows about: the
    // roster and member count moved, so refresh them wherever the user is.
    if (isPane) {
      dispatch(fetchMembers(channelId));
    }
    hydrateChannel(channelId, dispatch);
    return;
  }

  if (ce.eventType === ChatEventType.MEMBERS_REMOVED) {
    if (ce.payload.case === "membersChanged" && ce.payload.value) {
      const ids = ce.payload.value.userIds || [];
      if (ids.includes(currentUserId)) {
        dispatch(restrictForwardsFromChannel(channelId));
        dispatch(restrictThreadForwardsFromChannel(channelId));
        dispatch(clearChannelMessages(channelId));
        dispatch(removeChannel(channelId));
        return;
      }
    }
    if (isPane) {
      dispatch(fetchMembers(channelId));
    }
    hydrateChannel(channelId, dispatch);
    return;
  }

  // Sidebar last-activity ordering: every new message bumps its channel,
  // whether or not that channel is the one on screen.
  if (
    ce.eventType === ChatEventType.MESSAGE_CREATED &&
    ce.payload.case === "message" &&
    ce.payload.value
  ) {
    const created = timestampToIso(ce.payload.value.createdAt);
    if (created) {
      dispatch(
        touchChannelActivity({
          channelId,
          at: created,
          isRoot: !ce.payload.value.rootId,
        }),
      );
    }
  }

  if (
    ce.eventType === ChatEventType.MESSAGE_DELETED &&
    ce.payload.case === "messageDeleted" &&
    ce.payload.value
  ) {
    dispatch(restrictForwardsFromMessage(ce.payload.value.messageId));
    dispatch(restrictThreadForwardsFromMessage(ce.payload.value.messageId));
  }

  if (!isLive) return;

  switch (ce.eventType) {
    case ChatEventType.MESSAGE_CREATED: {
      if (ce.payload.case === "message" && ce.payload.value) {
        const msg = messageToPlain(ce.payload.value);
        // An agent emits several rows mid-turn (tool calls/results, the final
        // placeholder); its working indicator is owned by AGENT_TYPING
        // start/stop, so only a human's own message clears their typing entry.
        if (msg.senderType !== "AGENT") {
          dispatch(clearTypingUser({ channelId, userId: msg.senderId }));
        }
        if (msg.rootId) {
          dispatch(appendThreadMessage({ rootMessageId: msg.rootId, message: msg }));
        } else if (isPane) {
          dispatch(appendMessage({ channelId, message: msg }));
          // Viewing this channel live: mark the new message read so it never
          // surfaces as unread. Unread is time-based (last_read_at = now), so
          // the real id clears the just-arrived message too. Skip own sends;
          // thread replies do not count toward the channel badge. The read
          // cursor follows the left pane only; the split pane keeps its badge.
          if (
            channelId === live.activeChannelId &&
            msg.senderId !== currentUserId &&
            isDocumentVisible() &&
            live.manualUnread[channelId] !== true
          ) {
            dispatch(updateUnreadCounts([{ channelId, unreadCount: 0, mentionCount: 0 }]));
            dispatch(
              markChannelRead({
                channelId,
                lastReadMessageId: msg.id,
              }),
            );
          }
        }
      }
      break;
    }
    case ChatEventType.MESSAGE_UPDATED: {
      if (ce.payload.case === "message" && ce.payload.value) {
        dispatch(
          updateMessage({
            channelId,
            message: messageToPlain(ce.payload.value),
          }),
        );
      }
      break;
    }
    case ChatEventType.MESSAGE_DELETED: {
      if (ce.payload.case === "messageDeleted" && ce.payload.value) {
        dispatch(
          deleteMessage({
            channelId,
            messageId: ce.payload.value.messageId,
          }),
        );
      }
      break;
    }
    case ChatEventType.THREAD_UPDATED: {
      if (ce.payload.case === "threadUpdated" && ce.payload.value) {
        const p = ce.payload.value;
        const existing = getMessageById(p.rootMessageId);
        const existingParticipants = existing?.thread?.participantIds ?? [];
        const updatedParticipants = existingParticipants.includes(p.latestParticipantId)
          ? existingParticipants
          : [...existingParticipants, p.latestParticipantId];
        dispatch(
          updateMessage({
            channelId,
            message: {
              id: p.rootMessageId,
              channelId,
              thread: {
                replyCount: p.replyCount,
                lastReplyAt: timestampToIso(p.lastReplyAt) ?? new Date().toISOString(),
                participantIds: updatedParticipants,
                hasUnread: existing?.thread?.hasUnread ?? false,
              },
            } as never,
          }),
        );
      }
      break;
    }
    case ChatEventType.TYPING_STARTED: {
      if (ce.payload.case === "typing" && ce.payload.value) {
        dispatch(
          setTypingUser({
            channelId,
            userId: ce.payload.value.userId,
            displayName: ce.payload.value.displayName,
          }),
        );
      }
      break;
    }
    case ChatEventType.REACTION_ADDED: {
      if (ce.payload.case === "reaction" && ce.payload.value) {
        const { messageId, emoji, userId } = ce.payload.value;
        dispatch(
          addReactionToMessage({
            channelId,
            messageId,
            emoji,
            userId,
            currentUserId,
          }),
        );
        dispatch(
          addReactionToThreadMessage({
            messageId,
            emoji,
            userId,
            currentUserId,
          }),
        );
      }
      break;
    }
    case ChatEventType.REACTION_REMOVED: {
      if (ce.payload.case === "reaction" && ce.payload.value) {
        const { messageId, emoji, userId } = ce.payload.value;
        dispatch(
          removeReactionFromMessage({
            channelId,
            messageId,
            emoji,
            userId,
            currentUserId,
          }),
        );
        dispatch(
          removeReactionFromThreadMessage({
            messageId,
            emoji,
            userId,
            currentUserId,
          }),
        );
      }
      break;
    }
    case ChatEventType.AGENT_TYPING: {
      if (ce.payload.case === "agentTyping" && ce.payload.value) {
        const { agentId, displayName, started, rootId } = ce.payload.value;
        if (started) {
          dispatch(
            setAgentTyping({
              channelId,
              agentId,
              displayName,
              rootId: rootId || undefined,
            }),
          );
        } else {
          dispatch(
            clearAgentTyping({
              channelId,
              agentId,
              rootId: rootId || undefined,
            }),
          );
        }
      }
      break;
    }
    case ChatEventType.AGENT_TOKEN_DELTA: {
      if (ce.payload.case === "agentTokenDelta" && ce.payload.value) {
        const { messageId, delta, sequence, final } = ce.payload.value;
        // Placeholder lives in channel store OR thread bucket; dispatch to both, the non-owner no-ops.
        const payload = {
          channelId,
          messageId,
          delta,
          sequence: Number(sequence),
          final,
        };
        dispatch(appendDelta(payload));
        dispatch(
          appendDeltaToThreadMessage({
            messageId,
            delta,
            sequence: Number(sequence),
            final,
          }),
        );
      }
      break;
    }
    case ChatEventType.AGENT_THINKING_DELTA: {
      if (ce.payload.case === "agentThinkingDelta" && ce.payload.value) {
        const { messageId, blockId, delta, sequence, final, elapsedMs } = ce.payload.value;
        dispatch(
          appendAgentThinking({
            messageId,
            blockId,
            delta,
            sequence: Number(sequence),
            final,
            elapsedMs: Number(elapsedMs),
          }),
        );
      }
      break;
    }
    case ChatEventType.AGENT_TOOL_CALL: {
      // Redundant with the MESSAGE_CREATED companion the backend emits for each tool row.
      break;
    }
    case ChatEventType.AGENT_CONFIRMATION_REQUESTED: {
      if (ce.payload.case === "agentConfirmationRequested" && ce.payload.value) {
        const p = ce.payload.value;
        const expiresIso = p.expiresAt ? timestampToIso(p.expiresAt) : null;
        const synthetic: import("@/features/chat/types").ChatMessage = {
          id: p.requestId,
          channelId,
          senderId: p.agentId,
          senderType: "AGENT",
          content: "",
          rootId: null,
          replyToId: null,
          editedAt: null,
          isDeleted: false,
          isPinned: false,
          isForwarded: false,
          metadata: {
            kind: "confirmation_request",
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
        if (isPane) dispatch(appendMessage({ channelId, message: synthetic }));
      }
      break;
    }
    case ChatEventType.AGENT_CONFIRMATION_RESOLVED: {
      if (ce.payload.case === "agentConfirmationResolved" && ce.payload.value) {
        const { requestId } = ce.payload.value;
        dispatch(removeMessage({ channelId, messageId: requestId }));
      }
      break;
    }
  }
}

function usePersistentChatStream() {
  const dispatch = useAppDispatch();
  const organizationId = useAppSelector((state) => state.auth.currentOrganizationId);
  const activeChannelId = useAppSelector((state) => state.chatChannels.activeChannelId);
  const splitChannelId = useAppSelector((state) => state.chatChannels.splitChannelId);
  const threadChannelId = useAppSelector(selectActiveThreadChannelId);
  const currentUserId = useAppSelector((state) => state.auth.user?.id ?? "");
  const channelIds = useAppSelector((state) => state.chatChannels.ids);
  const manualUnread = useAppSelector((state) => state.chatChannels.manualUnread);

  // Refs keep the effect from re-running on channel switch or user change.
  // A re-run would drop and re-open the user stream, and events during that gap
  // are lost - resyncing them costs a full snapshot round trip.
  /* eslint-disable react/react-compiler -- latest-value refs keeping the stream connection alive across renders */
  const channelIdRef = useRef(activeChannelId);
  channelIdRef.current = activeChannelId;
  const splitChannelIdRef = useRef(splitChannelId);
  splitChannelIdRef.current = splitChannelId;
  const threadChannelIdRef = useRef(threadChannelId);
  threadChannelIdRef.current = threadChannelId;
  const userIdRef = useRef(currentUserId);
  userIdRef.current = currentUserId;
  const manualUnreadRef = useRef(manualUnread);
  manualUnreadRef.current = manualUnread;
  const byId = useAppSelector((state) => state.chatMessages.byId);
  const channelIdsRef = useRef(new Set<string>());
  channelIdsRef.current = new Set(channelIds);
  const byIdRef = useRef(byId);
  byIdRef.current = byId;
  /* eslint-enable react/react-compiler */
  const fetchingChannelsRef = useRef(new Set<string>());

  // Returning to the tab clears the badge the hidden-tab stream handlers left
  // on the active channel (see clearActiveChannelUnread).
  useEffect(() => {
    const onVisible = () => {
      if (isDocumentVisible()) {
        dispatch(clearActiveChannelUnread());
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [dispatch]);

  // Org chat policy gates the composer's broadcast typeahead; one fetch per org.
  useEffect(() => {
    if (!organizationId) return;
    dispatch(fetchChatPolicy());
  }, [organizationId, dispatch]);

  useEffect(() => {
    if (!organizationId) return;

    _activeController?.abort();

    let backoff = INITIAL_BACKOFF_MS;
    let mounted = true;
    let reconnecting = false;
    let controller: AbortController;
    let wakeRetry: (() => void) | undefined;

    const onOnline = () => {
      backoff = INITIAL_BACKOFF_MS;
      controller?.abort();
      wakeRetry?.();
    };

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
          dispatch(invalidateArchivedChannels({ clear: true }));
          if (reconnecting) void dispatch(fetchChannels());
          reconnecting = true;

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
                if (event.payload.case === "unreadCount" && event.payload.value) {
                  const p = event.payload.value;

                  // A cursor move carries the recomputed totals; it is the only
                  // publisher that can lower a badge, so it replaces rather than
                  // adds and outranks the reading-live rule below.
                  if (p.absolute) {
                    dispatch(
                      updateUnreadCounts([
                        {
                          channelId: p.channelId,
                          unreadCount: p.unreadCount,
                          mentionCount: p.mentionCount,
                          lastReadMessageId: p.lastReadMessageId,
                          firstUnreadMessageId: p.firstUnreadMessageId,
                        },
                      ]),
                    );
                    break;
                  }

                  // Channel open and window focused: the user is reading it now.
                  // Keep the badge clear and advance the read cursor instead of
                  // surfacing a phantom unread (which also cascades the chat
                  // notification read, so the bell does not accumulate).
                  if (
                    p.channelId === channelIdRef.current &&
                    isDocumentVisible() &&
                    manualUnreadRef.current[p.channelId] !== true
                  ) {
                    // Reading it live: keep the badge clear. The MESSAGE_CREATED
                    // handler advances the server read cursor with the real id.
                    dispatch(
                      updateUnreadCounts([
                        {
                          channelId: p.channelId,
                          unreadCount: 0,
                          mentionCount: 0,
                        },
                      ]),
                    );
                    break;
                  }

                  // Unknown channel (e.g. new DM): fetch and add it.
                  if (
                    !channelIdsRef.current.has(p.channelId) &&
                    !fetchingChannelsRef.current.has(p.channelId) &&
                    organizationId
                  ) {
                    fetchingChannelsRef.current.add(p.channelId);
                    void dispatch(fetchChannel(p.channelId)).finally(() => {
                      fetchingChannelsRef.current.delete(p.channelId);
                    });
                  } else {
                    dispatch(
                      incrementUnreadCount({
                        channelId: p.channelId,
                        mentionCount: p.mentionCount > 0 ? p.mentionCount : undefined,
                      }),
                    );
                  }
                }
                break;
              }
              case UserChatEventType.CHANNEL_EVENT: {
                handleChannelEvent(
                  event,
                  {
                    activeChannelId: channelIdRef.current,
                    splitChannelId: splitChannelIdRef.current,
                    threadChannelId: threadChannelIdRef.current,
                    manualUnread: manualUnreadRef.current,
                  },
                  userIdRef.current,
                  dispatch,
                  (id) => byIdRef.current[id],
                );
                break;
              }
              case UserChatEventType.THREAD_ACTIVITY: {
                dispatch(fetchThreadsInbox());
                break;
              }
              case UserChatEventType.MENTION_RECEIVED: {
                // Badge counting is owned by UNREAD_COUNT_CHANGED, which the
                // server sends alongside with the mention flag set; counting
                // here too double-badged every mention.
                break;
              }
              case UserChatEventType.DRAFT_CHANGED: {
                if (event.payload.case === "draftChanged" && event.payload.value) {
                  const p = event.payload.value;
                  // Skip our own echo; applying it would fight the local composer.
                  if (p.clientSessionId === draftClientSessionId) break;
                  if (p.deleted) {
                    dispatch(draftRemoved(draftKey(p.channelId, p.rootMessageId)));
                  } else {
                    dispatch(
                      draftUpserted({
                        channelId: p.channelId,
                        rootMessageId: p.rootMessageId ?? null,
                        content: p.content,
                        updatedAt: timestampToIso(p.updatedAt) ?? new Date().toISOString(),
                      }),
                    );
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
        await new Promise<void>((resolve) => {
          const timer = setTimeout(() => {
            wakeRetry = undefined;
            resolve();
          }, backoff + jitter);
          wakeRetry = () => {
            clearTimeout(timer);
            wakeRetry = undefined;
            resolve();
          };
        });
        backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
      }
    }

    window.addEventListener("online", onOnline);
    connect();

    return () => {
      mounted = false;
      window.removeEventListener("online", onOnline);
      _activeController?.abort();
      wakeRetry?.();
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
