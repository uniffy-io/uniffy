import { useEffect } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import {
  ChatEventType,
  type ChatEvent,
  type StreamUserChatEventsResponse,
} from "@uniffy/proto/chat/v1/chat_stream_pb";
import { chatStreamApi } from "@/api/chatStreamApi";
import { messagesKey } from "@/hooks/useChatMutations";
import { messageToPlain, type SerializedMessage } from "@/lib/chatSerializer";
import { useAuth } from "@/context/auth-context";

export type TypingEntry = { id: string; name: string; isAgent: boolean; at: number };

export function typingKey(orgId: string, channelId: string) {
  return ["chat", "typing", orgId, channelId];
}

/** True while the agent runtime reports an active run in the channel. */
export function agentRunKey(orgId: string, channelId: string) {
  return ["chat", "agentRun", orgId, channelId];
}

export function approvalsKey(orgId: string, channelId: string) {
  return ["chat", "approvals", orgId, channelId];
}

export const STREAM_HEALTH_KEY = ["chat", "stream", "healthy"];

const TYPING_TTL_MS = 8000;
const RECONNECT_BASE_MS = 2000;
const RECONNECT_MAX_MS = 30000;

let refCount = 0;
let controller: AbortController | null = null;
let sweepTimer: ReturnType<typeof setInterval> | null = null;
let currentOrgId: string | null = null;

/**
 * Subscribes the app to the unified chat event stream and mirrors events into
 * the React Query caches the chat screens already read. Connection is a
 * module-level singleton shared by every mounted subscriber. If the platform
 * fetch cannot consume the ConnectRPC server stream the loop fails, marks the
 * stream unhealthy, and the screens keep their polling cadence - streaming is
 * an accelerator, never a requirement.
 */
export function useChatStream() {
  const { organizationId } = useAuth();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!organizationId) return;
    refCount++;
    if (!controller || currentOrgId !== organizationId) {
      start(organizationId, queryClient);
    }
    return () => {
      refCount--;
      if (refCount <= 0) {
        refCount = 0;
        stop(queryClient);
      }
    };
  }, [organizationId, queryClient]);
}

function start(orgId: string, queryClient: QueryClient) {
  controller?.abort();
  const ctl = new AbortController();
  controller = ctl;
  currentOrgId = orgId;
  if (sweepTimer) clearInterval(sweepTimer);
  sweepTimer = setInterval(() => sweepTyping(queryClient), 5000);
  void runLoop(orgId, queryClient, ctl);
}

function stop(queryClient: QueryClient) {
  controller?.abort();
  controller = null;
  currentOrgId = null;
  if (sweepTimer) {
    clearInterval(sweepTimer);
    sweepTimer = null;
  }
  queryClient.setQueryData(STREAM_HEALTH_KEY, false);
}

async function runLoop(orgId: string, queryClient: QueryClient, ctl: AbortController) {
  let backoffMs = RECONNECT_BASE_MS;
  while (!ctl.signal.aborted) {
    try {
      const stream = chatStreamApi.streamUserChatEvents(
        { organizationId: orgId },
        { signal: ctl.signal },
      );
      for await (const event of stream) {
        if (ctl.signal.aborted) break;
        queryClient.setQueryData(STREAM_HEALTH_KEY, true);
        backoffMs = RECONNECT_BASE_MS;
        applyUserEvent(orgId, queryClient, event);
      }
    } catch {
      // Either a network drop or a platform fetch that cannot consume
      // server streams; both fall back to the polling cadence below.
    }
    queryClient.setQueryData(STREAM_HEALTH_KEY, false);
    if (ctl.signal.aborted) break;
    await sleep(backoffMs, ctl.signal);
    backoffMs = Math.min(backoffMs * 2, RECONNECT_MAX_MS);
  }
}

function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        resolve();
      },
      { once: true },
    );
  });
}

function applyUserEvent(
  orgId: string,
  queryClient: QueryClient,
  event: StreamUserChatEventsResponse,
) {
  switch (event.payload.case) {
    case "unreadCount": {
      const p = event.payload.value;
      queryClient.setQueryData<Record<string, { unread: number; mentions: number }>>(
        ["chat", "unread", orgId],
        (old) => ({
          ...(old ?? {}),
          [p.channelId]: { unread: p.unreadCount, mentions: p.mentionCount },
        }),
      );
      break;
    }
    case "threadActivity":
      void queryClient.invalidateQueries({ queryKey: ["chat", "threads", orgId] });
      break;
    case "channelEvent":
      applyChannelEvent(orgId, queryClient, event.payload.value);
      break;
    default:
      break;
  }
}

function applyChannelEvent(orgId: string, queryClient: QueryClient, ce: ChatEvent) {
  const channelId = ce.channelId;
  const msgKey = messagesKey(orgId, channelId);

  switch (ce.payload.case) {
    case "message": {
      const plain = messageToPlain(ce.payload.value);
      queryClient.setQueryData<SerializedMessage[]>(msgKey, (old) => {
        if (!old) return old;
        const withoutSelf = old.filter((m) => m.id !== plain.id);
        if (withoutSelf.length === old.length && plain.isDeleted) return old;
        return [plain, ...withoutSelf].sort((a, b) => b.createdAtSeconds - a.createdAtSeconds);
      });
      // Refetch fills in what the event lacks (attachments) and keeps the
      // channel list ordering fresh.
      void queryClient.invalidateQueries({ queryKey: msgKey });
      void queryClient.invalidateQueries({ queryKey: ["chat", "channels", orgId] });
      break;
    }
    case "messageDeleted": {
      const p = ce.payload.value;
      queryClient.setQueryData<SerializedMessage[]>(msgKey, (old) =>
        old ? old.filter((m) => m.id !== p.messageId) : old,
      );
      break;
    }
    case "reaction":
      void queryClient.invalidateQueries({ queryKey: msgKey });
      break;
    case "typing": {
      const p = ce.payload.value;
      const started = ce.eventType === ChatEventType.TYPING_STARTED;
      updateTyping(queryClient, orgId, channelId, p.userId, {
        started,
        name: p.displayName,
        isAgent: false,
      });
      break;
    }
    case "agentTyping": {
      const p = ce.payload.value;
      updateTyping(queryClient, orgId, channelId, p.agentId, {
        started: p.started,
        name: p.displayName,
        isAgent: true,
      });
      queryClient.setQueryData(agentRunKey(orgId, channelId), p.started);
      break;
    }
    case "agentTokenDelta": {
      const p = ce.payload.value;
      queryClient.setQueryData<SerializedMessage[]>(msgKey, (old) => {
        if (!old) return old;
        let found = false;
        const next = old.map((m) => {
          if (m.id !== p.messageId) return m;
          found = true;
          const lastSeq = Number(m.metadata.deltaSeq ?? "0");
          if (p.sequence <= lastSeq) return m;
          return {
            ...m,
            content: m.content + p.delta,
            metadata: { ...m.metadata, deltaSeq: String(p.sequence) },
          };
        });
        return found ? next : old;
      });
      if (p.final) void queryClient.invalidateQueries({ queryKey: msgKey });
      break;
    }
    case "agentConfirmationRequested":
    case "agentConfirmationResolved":
      void queryClient.invalidateQueries({ queryKey: approvalsKey(orgId, channelId) });
      break;
    case "member":
    case "membersChanged":
      void queryClient.invalidateQueries({ queryKey: ["chat", "members", orgId, channelId] });
      void queryClient.invalidateQueries({ queryKey: ["chat", "channels", orgId] });
      break;
    case "channelUpdated":
      void queryClient.invalidateQueries({ queryKey: ["chat", "channel", orgId, channelId] });
      void queryClient.invalidateQueries({ queryKey: ["chat", "channels", orgId] });
      break;
    case "threadUpdated":
      void queryClient.invalidateQueries({ queryKey: ["chat", "threads", orgId] });
      void queryClient.invalidateQueries({ queryKey: msgKey });
      break;
    default:
      break;
  }
}

function updateTyping(
  queryClient: QueryClient,
  orgId: string,
  channelId: string,
  subjectId: string,
  args: { started: boolean; name: string; isAgent: boolean },
) {
  queryClient.setQueryData<TypingEntry[]>(typingKey(orgId, channelId), (old) => {
    const rest = (old ?? []).filter((t) => t.id !== subjectId);
    if (!args.started) return rest;
    return [...rest, { id: subjectId, name: args.name, isAgent: args.isAgent, at: Date.now() }];
  });
}

function sweepTyping(queryClient: QueryClient) {
  const cutoff = Date.now() - TYPING_TTL_MS;
  const entries = queryClient.getQueriesData<TypingEntry[]>({ queryKey: ["chat", "typing"] });
  for (const [key, value] of entries) {
    if (!value || value.length === 0) continue;
    const fresh = value.filter((t) => t.at >= cutoff);
    if (fresh.length !== value.length) queryClient.setQueryData(key, fresh);
  }
}
