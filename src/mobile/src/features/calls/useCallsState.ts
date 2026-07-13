import { useQuery, type QueryClient } from "@tanstack/react-query";
import { useAuth } from "@core/providers/auth-context";
import type { PlainCall, PlainParticipant, RingInvite, CallEndReason } from "@features/calls/callsSerializer";

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

export function upsertActiveCall(qc: QueryClient, orgId: string, call: PlainCall) {
  qc.setQueryData<ActiveCallsMap>(activeCallsKey(orgId), (old) => ({
    ...(old ?? {}),
    [call.channelId]: call,
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
  for (const call of calls) map[call.channelId] = call;
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
