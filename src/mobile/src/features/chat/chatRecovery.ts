import { Code, ConnectError } from "@connectrpc/connect";
import type { Query, QueryClient } from "@tanstack/react-query";
import type { StreamUserChatEventsResponse } from "@uniffy/proto/chat/v1/chat_stream_pb";
import { ChatEventType } from "@uniffy/proto/chat/v1/chat_stream_pb";
import { RecoveryQueue } from "@features/chat/recoveryQueue";
import { chatApi } from "@features/chat/chatApi";
import { messageToPlain, type SerializedMessage } from "@features/chat/chatSerializer";
import { attachAttachments } from "@features/chat/messageAttachments";
import { mergeSendRows } from "@features/chat/sendState";
import { callsApi } from "@features/calls/callsApi";
import { callToPlain } from "@features/calls/callsSerializer";
import { syncActiveCalls, activeCallsKey } from "@features/calls/useCallsState";

function denied(error: unknown) {
  return (
    error instanceof ConnectError &&
    [Code.PermissionDenied, Code.NotFound, Code.Unauthenticated].includes(error.code)
  );
}
type Paged = { pages: unknown[]; pageParams: unknown[] };
type Paging = {
  initialPageParam?: unknown;
  getNextPageParam?: (
    last: unknown,
    pages: unknown[],
    lastParam: unknown,
    params: unknown[],
  ) => unknown;
};

export function createChatRecovery(orgId: string, client: QueryClient, signal: AbortSignal) {
  const deniedChannels = new Set<unknown>();
  const queue = new RecoveryQueue(() => !signal.aborted);
  const queries = () =>
    client
      .getQueryCache()
      .findAll({ predicate: (q) => q.queryKey[0] === "chat" && q.queryKey[2] === orgId });
  function request(query: Query) {
    const fn = query.options.queryFn;
    if (typeof fn !== "function") return;
    queue.request(query.queryHash, async () => {
      await client.cancelQueries({ queryKey: query.queryKey, exact: true }, { revert: false });
      const before = query.state.data;
      const channelId = query.queryKey[3];
      if (channelId && deniedChannels.has(channelId)) return () => {};
      try {
        const fetch = (pageParam?: unknown) =>
          fn({
            client,
            queryKey: query.queryKey,
            signal,
            meta: query.meta,
            pageParam,
            direction: "forward",
          } as Parameters<typeof fn>[0]);
        let data: unknown;
        if (query.queryKey[1] === "messages" && query.queryKey.length === 4) {
          const channelId = String(query.queryKey[3]);
          const olderKey = ["chat", "olderMessages", orgId, channelId];
          const older = client.getQueryData<SerializedMessage[]>(olderKey) ?? [];
          const target = Math.min(
            500,
            Math.max(50, (before as SerializedMessage[] | undefined)?.length ?? 0) + older.length,
          );
          let page = await chatApi.getMessages(
            { organizationId: orgId, channelId, rootOnly: true, limit: 100 },
            { signal },
          );
          let messages = page.messages.map(messageToPlain);
          while (page.hasMore && messages.length < target && messages.length) {
            page = await chatApi.getMessages(
              {
                organizationId: orgId,
                channelId,
                rootOnly: true,
                limit: 100,
                beforeId: messages[0].id,
              },
              { signal },
            );
            if (!page.messages.length || page.messages[0].id === messages[0].id) break;
            messages = [...page.messages.map(messageToPlain), ...messages];
          }
          await attachAttachments(orgId, messages);
          const local = ((before as SerializedMessage[] | undefined) ?? []).filter(
            (row) => row.metadata.optimistic === "1",
          );
          const recovered = mergeSendRows(local, messages);
          return () => {
            if (deniedChannels.has(channelId)) return;
            if (
              query.state.data !== before ||
              (client.getQueryData(olderKey) !== older &&
                client.getQueryData(olderKey) !== undefined)
            )
              return false;
            client.setQueryData(query.queryKey, recovered.slice(0, 50));
            client.setQueryData(olderKey, recovered.slice(50));
          };
        }
        const options = query.options as typeof query.options & Paging;
        if (options.getNextPageParam) {
          const previous = before as Paged | undefined;
          const pages: unknown[] = [];
          const pageParams: unknown[] = [];
          let cursor =
            query.queryKey[1] === "messages"
              ? (previous?.pageParams[0] ?? options.initialPageParam)
              : options.initialPageParam;
          for (let i = 0; i < Math.min(10, Math.max(1, previous?.pages.length ?? 1)); i++) {
            const page = await fetch(cursor);
            pages.push(page);
            pageParams.push(cursor);
            cursor = options.getNextPageParam(page, pages, cursor, pageParams);
            if (cursor === undefined || cursor === null) break;
          }
          data = { pages, pageParams };
        } else data = await fetch();
        return () => {
          if (channelId && deniedChannels.has(channelId)) return;
          if (query.state.data !== before) return false;
          client.setQueryData(query.queryKey, data);
        };
      } catch (error) {
        if (!denied(error)) throw error;
        return () => {
          if (channelId) deniedChannels.add(channelId);
          for (const cached of queries()) {
            if (cached === query || (channelId && cached.queryKey[3] === channelId)) {
              cached.setState({
                data: undefined,
                error: error as Error,
                status: "error",
                fetchStatus: "idle",
              });
            }
          }
        };
      }
    });
  }
  function recover() {
    deniedChannels.clear();
    for (const query of queries()) {
      const kind = query.queryKey[1];
      if (["typing", "agentRun", "agentThinking"].includes(String(kind))) {
        client.removeQueries({ queryKey: query.queryKey, exact: true });
        continue;
      }
      if (kind === "olderMessages") {
        if (
          !client
            .getQueryCache()
            .find({ queryKey: ["chat", "messages", orgId, query.queryKey[3]], exact: true })
            ?.isActive()
        )
          client.removeQueries({ queryKey: query.queryKey, exact: true });
        continue;
      }
      if (!query.getObserversCount()) {
        client.removeQueries({ queryKey: query.queryKey, exact: true });
        continue;
      }
      if (query.isActive()) request(query);
      else
        void client.invalidateQueries({
          queryKey: query.queryKey,
          exact: true,
          refetchType: "none",
        });
    }
    queue.request("calls", async () => {
      const before = client.getQueryData(activeCallsKey(orgId));
      const response = await callsApi.listActiveCalls({ organizationId: orgId });
      return () => {
        if (client.getQueryData(activeCallsKey(orgId)) !== before) return false;
        syncActiveCalls(client, orgId, response.calls.map(callToPlain));
      };
    });
  }
  function changed(event: StreamUserChatEventsResponse) {
    if (!queue.pending) return;
    const ce = event.payload.case === "channelEvent" ? event.payload.value : undefined;
    if (
      ce &&
      [
        ChatEventType.TYPING_STARTED,
        ChatEventType.AGENT_TYPING,
        ChatEventType.AGENT_THINKING_DELTA,
      ].includes(ce.eventType)
    )
      return;
    if (
      ce &&
      [
        ChatEventType.MEMBERS_ADDED,
        ChatEventType.MEMBER_JOINED,
        ChatEventType.CHANNEL_UPDATED,
      ].includes(ce.eventType)
    )
      deniedChannels.delete(ce.channelId);
    if (ce?.payload.case?.startsWith("call")) queue.changed("calls");
    for (const query of queries()) {
      const kind = query.queryKey[1];
      const affected = ce
        ? query.queryKey[3] === ce.channelId || ["channels", "threads"].includes(String(kind))
        : event.payload.case === "draftChanged"
          ? kind === "drafts"
          : event.payload.case === "unreadCount"
            ? kind === "unread"
            : event.payload.case === "threadActivity" && kind === "threads";
      if (affected && queue.changed(query.queryHash)) {
        void client.cancelQueries({ queryKey: query.queryKey, exact: true }, { revert: false });
      }
    }
  }
  return { recover, changed, stop: () => queue.stop() };
}
