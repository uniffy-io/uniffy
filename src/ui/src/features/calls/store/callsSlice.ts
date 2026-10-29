import { keepPublishingPolicy } from "@/features/calls/utils/callPublishing";
import { createSlice } from "@reduxjs/toolkit";
import type { PayloadAction } from "@reduxjs/toolkit";
import { ScreenShareQuality } from "@uniffy/proto/calls/v1/calls_pb";
import type {
  CallData,
  CallReactionData,
  CallParticipantData,
  CallEndReason,
  CallEndedInfo,
  CallSessionStatus,
  RingInvite,
} from "@/features/calls/types";
import type { RootState } from "@/app/store";

export interface CallSessionState {
  status: CallSessionStatus;
  callId: string | null;
  channelId: string | null;
  micEnabled: boolean;
  cameraEnabled: boolean;
  screenSharing: boolean;
  /** Org-resolved screen-share ceiling for the active session. */
  screenShareQualityCap: ScreenShareQuality;
}

export interface PrejoinTarget {
  channelId: string;
  calendarEventId?: string;
  /** Set when answering a ring: join exactly this call, never start a new one. */
  callId: string | null;
}

interface CallsState {
  activeByChannel: Record<string, CallData>;
  session: CallSessionState;
  ringInvites: RingInvite[];
  prejoin: PrejoinTarget | null;
  endedInfo: CallEndedInfo | null;
  /** Call this tab ended for everyone; its own end is not news to this user. */
  selfEndedCallId: string | null;
  feedback: string | null;
  reactions: CallReactionData[];
}

const idleSession: CallSessionState = {
  status: "idle",
  callId: null,
  channelId: null,
  micEnabled: false,
  cameraEnabled: false,
  screenSharing: false,
  screenShareQualityCap: ScreenShareQuality.BALANCED,
};

const initialState: CallsState = {
  activeByChannel: {},
  session: idleSession,
  ringInvites: [],
  prejoin: null,
  endedInfo: null,
  selfEndedCallId: null,
  feedback: null,
  reactions: [],
};

function findCallById(state: CallsState, callId: string): CallData | undefined {
  return Object.values(state.activeByChannel).find((c) => c.id === callId);
}

function keepLatestHand(
  previous: CallParticipantData | undefined,
  incoming: CallParticipantData,
): CallParticipantData {
  return previous?.joinedAt === incoming.joinedAt &&
    (previous?.handRevision ?? 0) > (incoming.handRevision ?? 0)
    ? { ...incoming, handRaisedAt: previous?.handRaisedAt, handRevision: previous?.handRevision }
    : incoming;
}

function mergeCallHands(previous: CallData | undefined, incoming: CallData): CallData {
  if (previous?.id !== incoming.id) return incoming;
  incoming = keepPublishingPolicy(previous, incoming);
  const byIdentity = new Map(previous.participants.map((p) => [p.identity, p]));
  return {
    ...incoming,
    participants: incoming.participants.map((p) => keepLatestHand(byIdentity.get(p.identity), p)),
  };
}

const callsSlice = createSlice({
  name: "calls",
  initialState,
  reducers: {
    reactionReceived(state, action: PayloadAction<CallReactionData>) {
      if (state.session.callId !== action.payload.callId) return;
      state.reactions = [
        ...state.reactions.filter((r) => r.expiresAt > Date.now() && r.id !== action.payload.id),
        action.payload,
      ].slice(-5);
    },
    feedbackChanged(state, action: PayloadAction<string | null>) {
      state.feedback = action.payload;
    },
    sessionTerminated(state, action: PayloadAction<CallEndedInfo>) {
      if (state.session.callId === action.payload.callId) {
        if (action.payload.reason !== null || state.endedInfo?.callId !== action.payload.callId) {
          state.endedInfo = action.payload;
        }
        state.feedback = null;
        state.session = idleSession;
      }
    },
    callUpserted(state, action: PayloadAction<CallData>) {
      const call = action.payload;
      if (call.endedAt) {
        delete state.activeByChannel[call.channelId];
      } else {
        state.activeByChannel[call.channelId] = mergeCallHands(
          state.activeByChannel[call.channelId],
          call,
        );
      }
    },
    callCleared(state, action: PayloadAction<string>) {
      delete state.activeByChannel[action.payload];
    },
    activeCallsSynced(state, action: PayloadAction<CallData[]>) {
      const previous = state.activeByChannel;
      state.activeByChannel = {};
      for (const call of action.payload) {
        if (!call.endedAt)
          state.activeByChannel[call.channelId] = mergeCallHands(previous[call.channelId], call);
      }
      const activeIds = new Set(action.payload.map((c) => c.id));
      state.ringInvites = state.ringInvites.filter((r) => activeIds.has(r.callId));
      // The session's call vanished while the stream was down: surface the
      // ended notice unless the SDK disconnect already reset the session.
      const { callId, channelId, status } = state.session;
      if (callId && channelId && status !== "idle" && !activeIds.has(callId)) {
        state.endedInfo = { callId, channelId, reason: null };
      }
    },
    callEnded(
      state,
      action: PayloadAction<{
        callId: string;
        channelId: string;
        reason: CallEndReason | null;
      }>,
    ) {
      const { callId, channelId, reason } = action.payload;
      const known = state.activeByChannel[channelId];
      if (known && known.id === callId) {
        delete state.activeByChannel[channelId];
      }
      state.ringInvites = state.ringInvites.filter((r) => r.callId !== callId);
      if (
        (state.session.callId === callId && state.session.status !== "idle") ||
        (state.endedInfo?.callId === callId && state.endedInfo.reason === null)
      ) {
        state.endedInfo = { callId, channelId, reason };
      }
    },
    participantUpserted(
      state,
      action: PayloadAction<{ callId: string; participant: CallParticipantData }>,
    ) {
      const call = findCallById(state, action.payload.callId);
      if (!call) return;
      const p = action.payload.participant;
      const idx = call.participants.findIndex((x) => x.identity === p.identity);
      if (idx >= 0) {
        call.participants[idx] = keepLatestHand(call.participants[idx], p);
      } else {
        call.participants.push(p);
      }
    },
    participantLeft(state, action: PayloadAction<{ callId: string; identity: string }>) {
      const call = findCallById(state, action.payload.callId);
      if (!call) return;
      call.participants = call.participants.filter((x) => x.identity !== action.payload.identity);
    },
    hostChanged(
      state,
      action: PayloadAction<{ callId: string; newHostUserId: string; publishingRevision?: number }>,
    ) {
      const call = findCallById(state, action.payload.callId);
      if (call && (action.payload.publishingRevision ?? 0) >= (call.publishingRevision ?? 0))
        call.hostUserId = action.payload.newHostUserId;
    },
    ringReceived(state, action: PayloadAction<RingInvite>) {
      if (state.ringInvites.some((r) => r.callId === action.payload.callId)) return;
      // Never ring for the call the user is already in.
      if (state.session.callId === action.payload.callId) return;
      state.ringInvites.push(action.payload);
    },
    ringDismissed(state, action: PayloadAction<string>) {
      state.ringInvites = state.ringInvites.filter((r) => r.callId !== action.payload);
    },
    prejoinOpened(
      state,
      action: PayloadAction<{ channelId: string; callId?: string; calendarEventId?: string }>,
    ) {
      state.prejoin = {
        channelId: action.payload.channelId,
        callId: action.payload.callId ?? null,
        calendarEventId: action.payload.calendarEventId,
      };
    },
    prejoinClosed(state) {
      state.prejoin = null;
    },
    sessionConnecting(
      state,
      action: PayloadAction<{
        callId: string;
        channelId: string;
        screenShareQualityCap: ScreenShareQuality;
      }>,
    ) {
      state.session = {
        ...idleSession,
        status: "connecting",
        callId: action.payload.callId,
        channelId: action.payload.channelId,
        screenShareQualityCap: action.payload.screenShareQualityCap,
      };
      state.endedInfo = null;
      state.feedback = null;
      state.ringInvites = state.ringInvites.filter((r) => r.callId !== action.payload.callId);
    },
    sessionConnected(state) {
      if (state.session.status !== "idle") state.session.status = "connected";
    },
    sessionReconnecting(state) {
      if (state.session.status !== "idle") state.session.status = "reconnecting";
    },
    sessionDisconnected(state) {
      if (state.session.status !== "idle") state.session.status = "disconnected";
    },
    sessionReset(state) {
      state.feedback = null;
      state.session = idleSession;
    },
    localMediaChanged(
      state,
      action: PayloadAction<
        Partial<Pick<CallSessionState, "micEnabled" | "cameraEnabled" | "screenSharing">>
      >,
    ) {
      Object.assign(state.session, action.payload);
    },
    callEndRequested(state, action: PayloadAction<string | null>) {
      state.selfEndedCallId = action.payload;
    },
    // Sign-out reset. The CallProvider tears the live Room down separately; this
    // only wipes the store so no roster, ring, or "live in call" chrome leaks
    // across an identity change.
    clearCalls() {
      return {
        activeByChannel: {},
        session: idleSession,
        ringInvites: [],
        prejoin: null,
        endedInfo: null,
        selfEndedCallId: null,
        feedback: null,
        reactions: [],
      };
    },
  },
});

export const {
  reactionReceived,
  feedbackChanged,
  sessionTerminated,
  callUpserted,
  callCleared,
  activeCallsSynced,
  callEnded,
  participantUpserted,
  participantLeft,
  hostChanged,
  ringReceived,
  ringDismissed,
  prejoinOpened,
  prejoinClosed,
  sessionConnecting,
  sessionConnected,
  sessionReconnecting,
  sessionDisconnected,
  sessionReset,
  localMediaChanged,
  callEndRequested,
  clearCalls,
} = callsSlice.actions;

export const callsReducer = callsSlice.reducer;

export const selectActiveCallForChannel = (state: RootState, channelId: string) =>
  state.calls.activeByChannel[channelId] ?? null;

export const selectCallSession = (state: RootState) => state.calls.session;

export const selectRingInvites = (state: RootState) => state.calls.ringInvites;

export const selectPrejoin = (state: RootState) => state.calls.prejoin;

export const selectEndedInfo = (state: RootState) => state.calls.endedInfo;

export const selectSelfEndedCallId = (state: RootState) => state.calls.selfEndedCallId;

export const selectSessionCall = (state: RootState) => {
  const { callId } = state.calls.session;
  if (!callId) return null;
  return Object.values(state.calls.activeByChannel).find((c) => c.id === callId) ?? null;
};
