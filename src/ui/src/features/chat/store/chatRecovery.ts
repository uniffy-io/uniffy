import { Code, ConnectError } from "@connectrpc/connect";
import type { AppDispatch, RootState } from "@/app/store";
import { chatApi } from "@/features/chat/api/chatApi";
import {
  channelToPlain,
  messageToPlain,
  memberToPlain,
  draftToPlain,
  threadInboxItemToPlain,
} from "@/features/chat/api/chatConverters";
import {
  loadMessagePage,
  removeChannelLocally,
  fetchChannelPendingApprovals,
} from "@/features/chat/store/chatThunks";
import {
  setMessages,
  setHasMore,
  cacheMessage,
  pruneChannelMessages,
  removeMessage,
  clearChannelMessages,
  recovered,
  resetTransient,
} from "@/features/chat/store/chatMessagesSlice";
import {
  setChannels,
  updateChannel,
  setChannelMembers,
  updateUnreadCounts,
  markUnreadCountsLoaded,
  invalidateArchivedChannels,
} from "@/features/chat/store/chatChannelsSlice";
import {
  setThreadMessages,
  setThreadsInbox,
  clearThreadMessages,
  setActiveThread,
} from "@/features/chat/store/chatThreadsSlice";
import { setDrafts } from "@/features/chat/store/chatDraftsSlice";
import { isChatSessionCurrent } from "@/features/chat/store/chatPreload";
import { RecoveryQueue } from "@/features/chat/utils/recoveryQueue";
import { callsApi } from "@/features/calls/api/callsApi";
import { callToPlain } from "@/features/calls/api/callsConverters";
import { activeCallsSynced } from "@/features/calls/store/callsSlice";
import type { StreamUserChatEventsResponse } from "@uniffy/proto/chat/v1/chat_stream_pb";
import { ChatEventType } from "@uniffy/proto/chat/v1/chat_stream_pb";

function denied(error: unknown) {
  return (
    error instanceof ConnectError &&
    [Code.PermissionDenied, Code.NotFound, Code.Unauthenticated].includes(error.code)
  );
}

export function createChatRecovery(getState: () => RootState, dispatch: AppDispatch) {
  const controller = new AbortController();
  const options = { signal: controller.signal };
  const auth = getState().auth;
  const organizationId = auth.currentOrganizationId!;
  const revoked = new Set<string>();
  const queue = new RecoveryQueue(() => isChatSessionCurrent(auth, getState().auth));
  function recoverChannel(channelId: string) {
    queue.request(`channel:${channelId}`, async () => {
      const before = getState().chatMessages.byId;
      const previousIds = getState().chatMessages.idsByChannel[channelId];
      const ids = previousIds ?? [];
      const windowed = getState().chatMessages.windowedByChannel[channelId];
      const aroundId = windowed ? ids.filter((id) => !before[id]?.sendStatus).at(-1) : undefined;
      try {
        const channel = await chatApi.getChannel({ organizationId, channelId }, options);
        const request = { organizationId, channelId, limit: 100, rootOnly: true };
        let page = await loadMessagePage({ ...request, aroundId }, controller.signal);
        let messages = page.messages;
        const target = Math.min(500, Math.max(50, ids.length));
        while (page.hasMore && messages.length < target && messages.length) {
          page = await loadMessagePage({ ...request, beforeId: messages[0].id }, controller.signal);
          if (!page.messages.length || page.messages[0].id === messages[0].id) break;
          messages = [...page.messages, ...messages];
        }
        const members = await chatApi.getMembers({ organizationId, channelId }, options);
        return () => {
          const latest = getState().chatMessages;
          if (
            latest.idsByChannel[channelId] !== previousIds ||
            ids.some((id) => latest.byId[id] !== before[id])
          )
            return false;
          if (channel.channel) dispatch(updateChannel(channelToPlain(channel.channel)));
          dispatch(setChannelMembers({ channelId, members: members.members.map(memberToPlain) }));
          dispatch(
            setMessages({
              channelId,
              messages,
              windowed: !!aroundId && messages.some((m) => m.id === aroundId),
            }),
          );
          dispatch(
            pruneChannelMessages({
              channelId,
              retainId: getState().chatThreads.activeThreadId ?? undefined,
            }),
          );
          dispatch(setHasMore({ channelId, hasMore: page.hasMore }));
          dispatch(recovered());
          void dispatch(fetchChannelPendingApprovals({ channelId }));
        };
      } catch (error) {
        if (!denied(error)) throw error;
        return () => {
          revoked.add(channelId);
          removeChannelLocally(getState(), dispatch, organizationId, channelId);
          for (const [rootId, messages] of Object.entries(getState().chatThreads.threadMessages)) {
            if (
              messages.some((m) => m.channelId === channelId) ||
              before[rootId]?.channelId === channelId
            ) {
              dispatch(clearThreadMessages(rootId));
              if (getState().chatThreads.activeThreadId === rootId) dispatch(setActiveThread(null));
            }
          }
        };
      }
    });
  }
  function recover() {
    revoked.clear();
    const state = getState();
    const rootId = state.chatThreads.activeThreadId;
    const root = rootId ? state.chatMessages.byId[rootId] : undefined;
    const active = new Set(
      [
        state.chatChannels.activeChannelId,
        state.chatChannels.splitChannelId,
        state.calls.session.channelId,
        root?.channelId,
      ].filter((id): id is string => !!id),
    );
    // Inactive history refetches on open; no stale hidden rows survive a gap.
    for (const channelId of Object.keys(state.chatMessages.idsByChannel))
      if (!active.has(channelId)) dispatch(clearChannelMessages(channelId));
    for (const id of Object.keys(state.chatThreads.threadMessages))
      if (id !== rootId) dispatch(clearThreadMessages(id));
    dispatch(resetTransient());
    dispatch(invalidateArchivedChannels({ clear: true }));
    queue.request("channels", async () => {
      const before = getState().chatChannels.byId;
      const channels: ReturnType<typeof channelToPlain>[] = [];
      let cursor: string | undefined;
      do {
        const page = await chatApi.listChannels({ organizationId, cursor }, options);
        channels.push(...page.channels.map(channelToPlain));
        cursor = page.nextCursor || undefined;
      } while (cursor);
      return () => {
        const current = getState();
        if (current.chatChannels.byId !== before) return false;
        const visible = channels.map((channel) => channel.id);
        const retained = [...active]
          .filter((id) => !visible.includes(id))
          .flatMap((id) => (current.chatChannels.byId[id] ? [current.chatChannels.byId[id]] : []));
        dispatch(setChannels([...channels, ...retained]));
      };
    });
    queue.request("unread", async () => {
      const before = getState().chatChannels.byId;
      const response = await chatApi.getUnreadCounts({ organizationId }, options);
      return () => {
        if (getState().chatChannels.byId !== before) return false;
        dispatch(updateUnreadCounts(response.channels));
        dispatch(markUnreadCountsLoaded());
      };
    });
    queue.request("drafts", async () => {
      const before = getState().chatDrafts.byKey;
      const response = await chatApi.listDrafts({ organizationId }, options);
      return () => {
        if (getState().chatDrafts.byKey !== before) return false;
        dispatch(setDrafts(response.drafts.map(draftToPlain)));
      };
    });
    queue.request("inbox", async () => {
      const response = await chatApi.getThreadsInbox({ organizationId, limit: 50 }, options);
      return () => {
        dispatch(setThreadsInbox(response.threads.map(threadInboxItemToPlain)));
      };
    });
    queue.request("calls", async () => {
      const before = getState().calls.activeByChannel;
      const response = await callsApi.listActiveCalls({ organizationId }, options);
      return () => {
        if (getState().calls.activeByChannel !== before) return false;
        dispatch(activeCallsSynced(response.calls.map(callToPlain)));
      };
    });
    for (const id of active) recoverChannel(id);
    if (rootId && root)
      queue.request(`thread:${rootId}`, async () => {
        const before = getState().chatThreads.threadMessages[rootId];
        try {
          const request = {
            organizationId,
            channelId: root.channelId,
            rootMessageId: rootId,
            limit: 100,
          };
          const thread = await chatApi.getThread(request, options);
          let page = await chatApi.getThreadMessages(request, options);
          let messages = page.messages.map(messageToPlain);
          while (
            page.hasMore &&
            messages.length < Math.min(500, before?.length ?? 50) &&
            messages.length
          ) {
            page = await chatApi.getThreadMessages(
              { ...request, beforeId: messages[0].id },
              options,
            );
            if (!page.messages.length || page.messages[0].id === messages[0].id) break;
            messages = [...page.messages.map(messageToPlain), ...messages];
          }
          return () => {
            if (revoked.has(root.channelId)) return;
            if (getState().chatThreads.threadMessages[rootId] !== before) return false;
            if (thread.rootMessage) dispatch(cacheMessage(messageToPlain(thread.rootMessage)));
            dispatch(setThreadMessages({ rootMessageId: rootId, messages }));
          };
        } catch (error) {
          if (!denied(error)) throw error;
          return () => {
            dispatch(clearThreadMessages(rootId));
            dispatch(removeMessage({ channelId: root.channelId, messageId: rootId }));
            if (getState().chatThreads.activeThreadId === rootId) dispatch(setActiveThread(null));
          };
        }
      });
  }
  function changed(event: StreamUserChatEventsResponse) {
    if (event.payload.case === "draftChanged") queue.changed("drafts");
    if (event.payload.case === "unreadCount") queue.changed("unread");
    if (event.payload.case === "threadActivity") queue.changed("inbox");
    if (event.payload.case !== "channelEvent") return;
    const ce = event.payload.value;
    if (
      [
        ChatEventType.TYPING_STARTED,
        ChatEventType.AGENT_TYPING,
        ChatEventType.AGENT_THINKING_DELTA,
      ].includes(ce.eventType)
    )
      return;
    queue.changed(`channel:${ce.channelId}`);
    queue.changed("channels");
    queue.changed("inbox");
    if (ce.payload.case?.startsWith("call")) queue.changed("calls");
    const rootId = getState().chatThreads.activeThreadId;
    if (rootId) queue.changed(`thread:${rootId}`);
  }
  return {
    recover,
    changed,
    stop: () => {
      queue.stop();
      controller.abort();
    },
  };
}
