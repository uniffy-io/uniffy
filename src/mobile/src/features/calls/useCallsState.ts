import { useQuery, type QueryClient } from "@tanstack/react-query";
import { useAuth } from "@core/providers/AuthContext";
import type {
  PlainCall,
  PlainParticipant,
  RingInvite,
  CallEndReason,
} from "@features/calls/callsSerializer";

export type ActiveCallsMap = Record<string, PlainCall>;

export interface LastEndedCall {
  callId: string;
  channelId: string;
  reason: CallEndReason;
  atMs: number;
}

export function activeCallsKey(orgId: string) {
  return ["calls", "active", orgId];
}

export function ringInvitesKey(orgId: string) {
  return ["calls", "rings", orgId];
}

export function lastEndedCallKey(orgId: string) {
  return ["calls", "lastEnded", orgId];
}

function keepLatestHand(
  previous: PlainParticipant | undefined,
  incoming: PlainParticipant,
): PlainParticipant {
  return previous?.joinedAtSeconds === incoming.joinedAtSeconds &&
    (previous?.handRevision ?? 0) > (incoming.handRevision ?? 0)
    ? { ...incoming, handRaisedAt: previous?.handRaisedAt, handRevision: previous?.handRevision }
    : incoming;
}
function mergeCallHands(previous: PlainCall | undefined, incoming: PlainCall): PlainCall {
  if (previous?.id !== incoming.id) return incoming;
  const byIdentity = new Map(previous.participants.map((p) => [p.identity, p]));
  return {
    ...incoming,
    participants: incoming.participants.map((p) => keepLatestHand(byIdentity.get(p.identity), p)),
  };
}

export function upsertActiveCall(qc: QueryClient, orgId: string, call: PlainCall) {
  qc.setQueryData<ActiveCallsMap>(activeCallsKey(orgId), (old) => ({
    ...old,
    [call.channelId]: mergeCallHands(old?.[call.channelId], call),
  }));
}

export function removeActiveCall(
  qc: QueryClient,
  orgId: string,
  channelId: string,
  callId: string,
) {
  qc.setQueryData<ActiveCallsMap>(activeCallsKey(orgId), (old) => {
    if (!old || old[channelId]?.id !== callId) return old ?? {};
    const next = { ...old };
    delete next[channelId];
    return next;
  });
}

export function applyParticipantEvent(
  qc: QueryClient,
  orgId: string,
  channelId: string,
  callId: string,
  participant: PlainParticipant,
  kind: "joined" | "left" | "state",
) {
  qc.setQueryData<ActiveCallsMap>(activeCallsKey(orgId), (old) => {
    const call = old?.[channelId];
    if (!call || call.id !== callId) return old ?? {};
    const previous = call.participants.find((p) => p.identity === participant.identity);
    participant = keepLatestHand(previous, participant);
    const rest = call.participants.filter((p) => p.identity !== participant.identity);
    const participants = kind === "left" ? rest : [...rest, participant];
    return { ...old, [channelId]: { ...call, participants } };
  });
}

export function setCallHost(qc: QueryClient, orgId: string, callId: string, hostUserId: string) {
  qc.setQueryData<ActiveCallsMap>(activeCallsKey(orgId), (old) => {
    if (!old) return old ?? {};
    const entry = Object.entries(old).find(([, c]) => c.id === callId);
    if (!entry) return old;
    const [channelId, call] = entry;
    return { ...old, [channelId]: { ...call, hostUserId } };
  });
}

export function pushRingInvite(qc: QueryClient, orgId: string, invite: RingInvite) {
  qc.setQueryData<RingInvite[]>(ringInvitesKey(orgId), (old) => {
    const rest = (old ?? []).filter((r) => r.callId !== invite.callId);
    return [...rest, invite];
  });
}

export function dismissRingInvite(qc: QueryClient, orgId: string, callId: string) {
  qc.setQueryData<RingInvite[]>(ringInvitesKey(orgId), (old) =>
    (old ?? []).filter((r) => r.callId !== callId),
  );
}

export function recordEndedCall(qc: QueryClient, orgId: string, ended: LastEndedCall) {
  qc.setQueryData<LastEndedCall>(lastEndedCallKey(orgId), ended);
}

/** Full snapshot replace from ListActiveCalls; prunes rings for dead calls. */
export function syncActiveCalls(qc: QueryClient, orgId: string, calls: PlainCall[]) {
  const map: ActiveCallsMap = {};
  const previous = qc.getQueryData<ActiveCallsMap>(activeCallsKey(orgId));
  for (const call of calls) map[call.channelId] = mergeCallHands(previous?.[call.channelId], call);
  qc.setQueryData<ActiveCallsMap>(activeCallsKey(orgId), map);
  const alive = new Set(calls.map((c) => c.id));
  qc.setQueryData<RingInvite[]>(ringInvitesKey(orgId), (old) =>
    (old ?? []).filter((r) => alive.has(r.callId)),
  );
}

export function useActiveCalls(): ActiveCallsMap {
  const { organizationId } = useAuth();
  const query = useQuery<ActiveCallsMap>({
    queryKey: activeCallsKey(organizationId ?? ""),
    queryFn: () => ({}),
    enabled: false,
    staleTime: Infinity,
  });
  return query.data ?? {};
}

export function useActiveCall(channelId: string | undefined): PlainCall | undefined {
  const calls = useActiveCalls();
  return channelId ? calls[channelId] : undefined;
}

export function useRingInvites(): RingInvite[] {
  const { organizationId } = useAuth();
  const query = useQuery<RingInvite[]>({
    queryKey: ringInvitesKey(organizationId ?? ""),
    queryFn: () => [],
    enabled: false,
    staleTime: Infinity,
  });
  return query.data ?? [];
}

export interface ModeratorMute {
  callId: string;
  identity: string;
  atMs: number;
}

export function moderatorMuteKey(orgId: string) {
  return ["calls", "moderatorMute", orgId];
}

export interface CallReactionData {
  id: string;
  callId: string;
  userId: string;
  displayName: string;
  reaction: import("@uniffy/proto/calls/v1/calls_pb").CallReaction;
  expiresAt: number;
}
export function reactionsKey(orgId: string) {
  return ["calls", "reactions", orgId];
}
export function pushCallReaction(qc: QueryClient, orgId: string, reaction: CallReactionData) {
  if (reaction.expiresAt <= Date.now()) return;
  qc.setQueryData<CallReactionData[]>(reactionsKey(orgId), (old) =>
    [
      ...(old ?? []).filter((r) => r.expiresAt > Date.now() && r.id !== reaction.id),
      reaction,
    ].slice(-5),
  );
}
export function useCallReactions() {
  const { organizationId } = useAuth();
  return (
    useQuery<CallReactionData[]>({
      queryKey: reactionsKey(organizationId ?? ""),
      queryFn: () => [],
      enabled: false,
      staleTime: Infinity,
    }).data ?? []
  );
}
