import { useEffect } from "react";
import { AppState } from "react-native";
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import {
  ChatEventType,
  type ChatEvent,
  type StreamUserChatEventsResponse,
} from "@uniffy/proto/chat/v1/chat_stream_pb";
import { chatStreamApi } from "@features/chat/chatStreamApi";
import { callsApi } from "@features/calls/callsApi";
import { draftClientSessionId } from "@features/chat/chatApi";
import {
  messagesKey,
  draftsKey,
  upsertDraftInCache,
  removeDraftFromCache,
} from "@features/chat/useChatMutations";
import {
  messageToPlain,
  draftKey,
  tsToIso,
  type SerializedMessage,
} from "@features/chat/chatSerializer";
import {
  callToPlain,
  participantToPlain,
  ringToInvite,
  endReasonToPlain,
} from "@features/calls/callsSerializer";
import {
  upsertActiveCall,
  removeActiveCall,
  applyParticipantEvent,
  setCallHost,
  pushRingInvite,
  recordEndedCall,
  syncActiveCalls,
} from "@features/calls/useCallsState";
import { useAuth } from "@core/providers/AuthContext";
import { addOnlineListener } from "@core/api/connectivity";

export type TypingEntry = { id: string; name: string; isAgent: boolean; at: number };

export function typingKey(orgId: string, channelId: string) {
  return ["chat", "typing", orgId, channelId];
}

/** Ids of agents with an active run in the channel (stream-patched). */
export function agentRunKey(orgId: string, channelId: string) {
  return ["chat", "agentRun", orgId, channelId];
}

/**
 * Subscribe to the channel's running-agent ids without ever fetching.
 * Undefined until the stream delivers the first agent-typing event, so
 * callers can fall back to a heuristic while the stream is down.
 */
export function useRunningAgents(channelId: string | undefined): string[] | undefined {
  const { organizationId } = useAuth();
  const query = useQuery<string[]>({
    queryKey: agentRunKey(organizationId ?? "", channelId ?? ""),
    queryFn: () => [],
    enabled: false,
    staleTime: Infinity,
  });
  return query.data;
}

export type AgentThinkingBlock = {
  blockId: string;
  content: string;
  elapsedMs: number;
  done: boolean;
  lastSequence: number;
};

export function agentThinkingKey(orgId: string, channelId: string) {
  return ["chat", "agentThinking", orgId, channelId];
}

/**
 * Reasoning blocks per assistant message id, stream-patched and never
 * fetched: thinking is not persisted server-side, so it exists only for
 * replies streamed while this cache entry is alive.
 */
export function useAgentThinking(
  channelId: string | undefined,
): Record<string, AgentThinkingBlock[]> | undefined {
  const { organizationId } = useAuth();
  const query = useQuery<Record<string, AgentThinkingBlock[]>>({
    queryKey: agentThinkingKey(organizationId ?? "", channelId ?? ""),
    queryFn: () => ({}),
    enabled: false,
    staleTime: Infinity,
  });
  return query.data;
}

export function approvalsKey(orgId: string, channelId: string) {
  return ["chat", "approvals", orgId, channelId];
}

export const STREAM_HEALTH_KEY = ["chat", "stream", "healthy"];

// Match web: humans clear fast (5s), agents linger (15s) since a long run
// publishes no keepalive between its start and stop typing events.
const HUMAN_TYPING_TTL_MS = 5000;
const AGENT_TYPING_TTL_MS = 15000;
const RECONNECT_BASE_MS = 2000;
const RECONNECT_MAX_MS = 30000;
// The server heartbeats every 30s; 75s of silence means the socket is gone
// even though the platform never errors it (half-open TCP on LTE, iOS
// suspending sockets in background).
const STREAM_IDLE_LIMIT_MS = 75000;
const WATCHDOG_TICK_MS = 15000;
// On a foreground/online kick, one missed heartbeat plus slack is enough
// evidence to abandon the current socket instead of waiting out the watchdog.
const KICK_STALE_MS = 35000;

let refCount = 0;
let controller: AbortController | null = null;
let attemptController: AbortController | null = null;
let lastEventAtMs = 0;
let sweepTimer: ReturnType<typeof setInterval> | null = null;
let currentOrgId: string | null = null;
let lifecycleUnsubs: (() => void)[] = [];
let sleepWakers: (() => void)[] = [];

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
  sweepTimer = setInterval(() => sweepTyping(queryClient), 2000);
  for (const unsub of lifecycleUnsubs) unsub();
  const appStateSub = AppState.addEventListener("change", (state) => {
    if (state === "active") kick();
  });
  const removeOnline = addOnlineListener((online) => {
    if (online) kick();
  });
  lifecycleUnsubs = [() => appStateSub.remove(), removeOnline];
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
  for (const unsub of lifecycleUnsubs) unsub();
  lifecycleUnsubs = [];
  queryClient.setQueryData(STREAM_HEALTH_KEY, false);
}

// Foreground or connectivity regained: skip any backoff sleep, and drop the
// current socket when it has already missed a heartbeat (likely dead after
// background suspension or a network switch).
function kick() {
  if (attemptController && Date.now() - lastEventAtMs > KICK_STALE_MS) {
    attemptController.abort();
  }
  const wakers = sleepWakers;
  sleepWakers = [];
  for (const wake of wakers) wake();
}

async function runLoop(orgId: string, queryClient: QueryClient, ctl: AbortController) {
  let backoffMs = RECONNECT_BASE_MS;
  while (!ctl.signal.aborted) {
    const attempt = new AbortController();
    attemptController = attempt;
    const onOuterAbort = () => attempt.abort();
    ctl.signal.addEventListener("abort", onOuterAbort, { once: true });
    lastEventAtMs = Date.now();
    const watchdog = setInterval(() => {
      if (Date.now() - lastEventAtMs > STREAM_IDLE_LIMIT_MS) attempt.abort();
    }, WATCHDOG_TICK_MS);
    try {
      const stream = chatStreamApi.streamUserChatEvents(
        { organizationId: orgId },
        { signal: attempt.signal },
      );
      // Stream events are a latency optimization for calls, not the source of
      // truth: resync the active-call snapshot on every (re)connect attempt.
      // While the stream is down this doubles as the polling fallback, riding
      // the same backoff cadence. Drafts get the same snapshot resync to pick
      // up whatever changed while the stream was down.
      void resyncActiveCalls(orgId, queryClient, attempt.signal);
      void queryClient.invalidateQueries({ queryKey: draftsKey(orgId) });
      for await (const event of stream) {
        if (attempt.signal.aborted) break;
        lastEventAtMs = Date.now();
        queryClient.setQueryData(STREAM_HEALTH_KEY, true);
        backoffMs = RECONNECT_BASE_MS;
        applyUserEvent(orgId, queryClient, event);
      }
    } catch {
      // Network drop, watchdog abort, or a platform fetch that cannot consume
      // server streams; all fall back to the polling cadence below.
    } finally {
      clearInterval(watchdog);
      ctl.signal.removeEventListener("abort", onOuterAbort);
      if (attemptController === attempt) attemptController = null;
    }
    queryClient.setQueryData(STREAM_HEALTH_KEY, false);
    if (ctl.signal.aborted) break;
    await sleep(jitter(backoffMs), ctl.signal);
    backoffMs = Math.min(backoffMs * 2, RECONNECT_MAX_MS);
  }
}

// Desynchronizes reconnects across clients so a server restart does not get
// hammered by every device on the same beat.
function jitter(ms: number): number {
  return Math.round(ms * (0.75 + Math.random() * 0.5));
}

async function resyncActiveCalls(orgId: string, queryClient: QueryClient, signal: AbortSignal) {
  try {
    const response = await callsApi.listActiveCalls({ organizationId: orgId });
    if (signal.aborted) return;
    syncActiveCalls(queryClient, orgId, response.calls.map(callToPlain));
  } catch {
    // Best-effort: stale indicators until the next reconnect cycle.
  }
}

function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(t);
      sleepWakers = sleepWakers.filter((w) => w !== finish);
      resolve();
    };
    const t = setTimeout(finish, ms);
    sleepWakers.push(finish);
    signal.addEventListener("abort", finish, { once: true });
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
      // The payload is the delta for one message, not the channel total: the
      // server sends 1 per send (with the mention flag) and the web store adds
      // it the same way. GetUnreadCounts restores the absolute numbers on its
      // poll and after every mark-read, so a missed event heals itself.
      queryClient.setQueryData<Record<string, { unread: number; mentions: number }>>(
        ["chat", "unread", orgId],
        (old) => {
          const prev = old?.[p.channelId] ?? { unread: 0, mentions: 0 };
          return {
            ...old,
            [p.channelId]: {
              unread: prev.unread + p.unreadCount,
              mentions: prev.mentions + p.mentionCount,
            },
          };
        },
      );
      break;
    }
    case "threadActivity":
      void queryClient.invalidateQueries({ queryKey: ["chat", "threads", orgId] });
      break;
    case "draftChanged": {
      const p = event.payload.value;
      // Events this session caused are already reflected locally; applying
      // them would fight the composer mid-keystroke.
      if (p.clientSessionId === draftClientSessionId) break;
      if (p.deleted) {
        removeDraftFromCache(queryClient, orgId, draftKey(p.channelId, p.rootMessageId));
      } else {
        upsertDraftInCache(queryClient, orgId, {
          channelId: p.channelId,
          rootMessageId: p.rootMessageId ?? null,
          content: p.content,
          updatedAt: tsToIso(p.updatedAt),
        });
      }
      break;
    }
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
  const channelsKey = ["chat", "channels", orgId];
  const channelKey = ["chat", "channel", orgId, channelId];

  // Channel lifecycle reaches every member's session whatever channel is on
  // screen, and CHANNEL_CREATED carries no payload at all, so these key off
  // the event type rather than the payload case.
  switch (ce.eventType) {
    case ChatEventType.CHANNEL_CREATED:
      void queryClient.invalidateQueries({ queryKey: channelsKey });
      return;
    case ChatEventType.CHANNEL_UPDATED: {
      // Archive and delete both arrive as is_archived, and the row is then
      // gone for this member: only the list has anything left to show.
      const removed = ce.payload.case === "channelUpdated" && ce.payload.value.isArchived;
      if (!removed) void queryClient.invalidateQueries({ queryKey: channelKey });
      void queryClient.invalidateQueries({ queryKey: channelsKey });
      return;
    }
    case ChatEventType.MEMBERS_ADDED:
    case ChatEventType.MEMBERS_REMOVED:
      // An agent-only change carries no user_ids, so the roster and the member
      // count refresh off the event type alone. The list refetch is what makes
      // the channel appear or disappear when the changed member is this user.
      void queryClient.invalidateQueries({ queryKey: ["chat", "members", orgId, channelId] });
      void queryClient.invalidateQueries({ queryKey: channelKey });
      void queryClient.invalidateQueries({ queryKey: channelsKey });
      return;
    default:
      break;
  }

  switch (ce.payload.case) {
    case "message": {
      const plain = messageToPlain(ce.payload.value);
      queryClient.setQueryData<SerializedMessage[]>(msgKey, (old) => {
        if (!old) return old;
        const withoutSelf = old.filter((m) => m.id !== plain.id);
        if (withoutSelf.length === old.length && plain.isDeleted) return old;
        return [plain, ...withoutSelf].sort((a, b) => b.createdAtSeconds - a.createdAtSeconds);
      });
      // Drop the sender's typing row the instant their message lands, so it
      // never lingers behind the message (web parity). Agents keep their row
      // until their explicit stop event, since they stream after the first row.
      if (plain.senderType === "USER") {
        updateTyping(queryClient, orgId, channelId, plain.senderId, {
          started: false,
          name: "",
          isAgent: false,
        });
      }
      // Refetch fills in what the event lacks (attachments) and keeps the
      // channel list ordering fresh.
      void queryClient.invalidateQueries({ queryKey: msgKey });
      void queryClient.invalidateQueries({ queryKey: channelsKey });
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
      queryClient.setQueryData<string[]>(agentRunKey(orgId, channelId), (old) => {
        const rest = (old ?? []).filter((id) => id !== p.agentId);
        return p.started ? [...rest, p.agentId] : rest;
      });
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
    case "agentThinkingDelta": {
      const p = ce.payload.value;
      queryClient.setQueryData<Record<string, AgentThinkingBlock[]>>(
        agentThinkingKey(orgId, channelId),
        (old) => {
          const blocks = old?.[p.messageId] ?? [];
          const existing = blocks.find((b) => b.blockId === p.blockId);
          const base = existing ?? {
            blockId: p.blockId,
            content: "",
            elapsedMs: 0,
            done: false,
            lastSequence: 0,
          };
          if (p.sequence <= base.lastSequence && !p.final) return old;
          const updated: AgentThinkingBlock = {
            ...base,
            lastSequence: p.sequence,
            content: p.delta ? base.content + p.delta : base.content,
            done: base.done || p.final,
            elapsedMs: p.final ? p.elapsedMs : base.elapsedMs,
          };
          const nextBlocks = existing
            ? blocks.map((b) => (b.blockId === p.blockId ? updated : b))
            : [...blocks, updated];
          return { ...old, [p.messageId]: nextBlocks };
        },
      );
      break;
    }
    case "agentConfirmationRequested":
    case "agentConfirmationResolved":
      void queryClient.invalidateQueries({ queryKey: approvalsKey(orgId, channelId) });
      break;
    case "member":
      void queryClient.invalidateQueries({ queryKey: ["chat", "members", orgId, channelId] });
      void queryClient.invalidateQueries({ queryKey: channelsKey });
      break;
    case "threadUpdated":
      void queryClient.invalidateQueries({ queryKey: ["chat", "threads", orgId] });
      void queryClient.invalidateQueries({ queryKey: msgKey });
      break;
    case "callLifecycle": {
      const call = ce.payload.value.call;
      if (!call) break;
      if (ce.eventType === ChatEventType.CALL_ENDED) {
        removeActiveCall(queryClient, orgId, call.channelId, call.id);
        recordEndedCall(queryClient, orgId, {
          callId: call.id,
          channelId: call.channelId,
          reason: endReasonToPlain(call.endReason),
          atMs: Date.now(),
        });
      } else {
        upsertActiveCall(queryClient, orgId, callToPlain(call));
      }
      break;
    }
    case "callParticipant": {
      const p = ce.payload.value;
      if (!p.participant) break;
      const kind = ce.eventType === ChatEventType.CALL_PARTICIPANT_LEFT ? "left" : "joined";
      applyParticipantEvent(
        queryClient,
        orgId,
        channelId,
        p.callId,
        participantToPlain(p.participant),
        ce.eventType === ChatEventType.CALL_PARTICIPANT_STATE ? "state" : kind,
      );
      break;
    }
    case "callRing":
      pushRingInvite(queryClient, orgId, ringToInvite(ce.payload.value, channelId));
      break;
    case "callHostChanged": {
      const p = ce.payload.value;
      setCallHost(queryClient, orgId, p.callId, p.newHostUserId);
      break;
    }
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
  const now = Date.now();
  const entries = queryClient.getQueriesData<TypingEntry[]>({ queryKey: ["chat", "typing"] });
  for (const [key, value] of entries) {
    if (!value || value.length === 0) continue;
    const fresh = value.filter(
      (t) => now - t.at < (t.isAgent ? AGENT_TYPING_TTL_MS : HUMAN_TYPING_TTL_MS),
    );
    if (fresh.length !== value.length) queryClient.setQueryData(key, fresh);
  }
}
