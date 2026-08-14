import { createAsyncThunk } from "@reduxjs/toolkit";
import { callsApi } from "@/features/calls/api/callsApi";
import { callToPlain, iceServersToPlain } from "@/features/calls/api/callsConverters";
import {
  activeCallsSynced,
  callCleared,
  callEnded,
  callUpserted,
  ringDismissed,
} from "@/features/calls/store/callsSlice";
import { getDeviceId, getDeviceLabel } from "@/shared/utils/deviceId";
import { ScreenShareQuality, IceTransportPolicy } from "@uniffy/proto/calls/v1/calls_pb";
import type { CallData, IceServerData } from "@/features/calls/types";
import type { RootState } from "@/app/store";

const getOrganizationId = (state: RootState): string => {
  const orgId = state.auth.currentOrganizationId;
  if (!orgId) throw new Error("No organization selected");
  return orgId;
};

export interface CallJoinResult {
  call: CallData;
  wsUrl: string;
  livekitToken: string;
  joinedExisting: boolean;
  /** Org-resolved screen-share ceiling for this session. */
  screenShareQualityCap: ScreenShareQuality;
  /** Empty in direct-media mode; per-user TURN relay config otherwise. */
  iceServers: IceServerData[];
  iceTransportPolicy: IceTransportPolicy;
}

export const fetchActiveCall = createAsyncThunk(
  "calls/fetchActiveCall",
  async (channelId: string, { getState, dispatch }) => {
    const organizationId = getOrganizationId(getState() as RootState);
    const res = await callsApi.getActiveCall({ organizationId, channelId });
    if (res.call) {
      const call = callToPlain(res.call);
      dispatch(callUpserted(call));
      return call;
    }
    // No active call: drop any stale entry (a CALL_ENDED missed during a
    // stream gap would otherwise pin the indicator forever).
    dispatch(callCleared(channelId));
    return null;
  },
);

/**
 * Full indicator resync across the user's channels. Runs on every chat
 * stream (re)connect; events lost during the gap are corrected here.
 * Swallows errors: a failed background sync must not toast, the next
 * reconnect retries it.
 */
export const syncActiveCalls = createAsyncThunk(
  "calls/syncActiveCalls",
  async (_: void, { getState, dispatch }) => {
    try {
      const organizationId = getOrganizationId(getState() as RootState);
      const res = await callsApi.listActiveCalls({ organizationId });
      dispatch(activeCallsSynced(res.calls.map(callToPlain)));
    } catch {
      return null;
    }
    return null;
  },
);

export const initiateCall = createAsyncThunk(
  "calls/initiateCall",
  async (channelId: string, { getState, dispatch }): Promise<CallJoinResult> => {
    const organizationId = getOrganizationId(getState() as RootState);
    const res = await callsApi.initiateCall({
      organizationId,
      channelId,
      deviceId: getDeviceId(),
      deviceLabel: getDeviceLabel(),
    });
    if (!res.call) throw new Error("Call missing from response");
    const call = callToPlain(res.call);
    dispatch(callUpserted(call));
    return {
      call,
      wsUrl: res.wsUrl,
      livekitToken: res.livekitToken,
      joinedExisting: res.joinedExisting,
      screenShareQualityCap: res.screenShareQualityCap,
      iceServers: iceServersToPlain(res.iceServers),
      iceTransportPolicy: res.iceTransportPolicy,
    };
  },
);

export const joinCall = createAsyncThunk(
  "calls/joinCall",
  async (callId: string, { getState, dispatch }): Promise<CallJoinResult> => {
    const organizationId = getOrganizationId(getState() as RootState);
    const res = await callsApi.joinCall({
      organizationId,
      callId,
      deviceId: getDeviceId(),
      deviceLabel: getDeviceLabel(),
    });
    if (!res.call) throw new Error("Call missing from response");
    const call = callToPlain(res.call);
    dispatch(callUpserted(call));
    return {
      call,
      wsUrl: res.wsUrl,
      livekitToken: res.livekitToken,
      joinedExisting: true,
      screenShareQualityCap: res.screenShareQualityCap,
      iceServers: iceServersToPlain(res.iceServers),
      iceTransportPolicy: res.iceTransportPolicy,
    };
  },
);

/**
 * JoinCall without the thunk wrapper, so the 90s reconnect loop can retry
 * without each failed attempt becoming a rejected action that the error-toast
 * middleware surfaces as a "could not connect" toast. Throws on failure for the
 * caller's own handling.
 */
export async function joinCallRequest(
  organizationId: string,
  callId: string,
): Promise<CallJoinResult> {
  const res = await callsApi.joinCall({
    organizationId,
    callId,
    deviceId: getDeviceId(),
    deviceLabel: getDeviceLabel(),
  });
  if (!res.call) throw new Error("Call missing from response");
  return {
    call: callToPlain(res.call),
    wsUrl: res.wsUrl,
    livekitToken: res.livekitToken,
    joinedExisting: true,
    screenShareQualityCap: res.screenShareQualityCap,
    iceServers: iceServersToPlain(res.iceServers),
    iceTransportPolicy: res.iceTransportPolicy,
  };
}

export const leaveCall = createAsyncThunk(
  "calls/leaveCall",
  async (callId: string, { getState }) => {
    const organizationId = getOrganizationId(getState() as RootState);
    await callsApi.leaveCall({ organizationId, callId, deviceId: getDeviceId() });
  },
);

export const endCall = createAsyncThunk(
  "calls/endCall",
  async ({ callId, channelId }: { callId: string; channelId: string }, { getState, dispatch }) => {
    const organizationId = getOrganizationId(getState() as RootState);
    await callsApi.endCall({ organizationId, callId });
    dispatch(callEnded({ callId, channelId, reason: "HOST_ENDED" }));
  },
);

export const refreshCallToken = createAsyncThunk(
  "calls/refreshCallToken",
  async (callId: string, { getState }): Promise<string> => {
    const organizationId = getOrganizationId(getState() as RootState);
    const res = await callsApi.refreshCallToken({
      organizationId,
      callId,
      deviceId: getDeviceId(),
    });
    return res.livekitToken;
  },
);

export const declineCall = createAsyncThunk(
  "calls/declineCall",
  async (callId: string, { getState, dispatch }) => {
    const organizationId = getOrganizationId(getState() as RootState);
    dispatch(ringDismissed(callId));
    await callsApi.declineCall({ organizationId, callId });
  },
);

export const kickParticipant = createAsyncThunk(
  "calls/kickParticipant",
  async ({ callId, identity }: { callId: string; identity: string }, { getState }) => {
    const organizationId = getOrganizationId(getState() as RootState);
    await callsApi.kickParticipant({ organizationId, callId, identity });
  },
);

export const muteParticipant = createAsyncThunk(
  "calls/muteParticipant",
  async ({ callId, identity }: { callId: string; identity: string }, { getState }) => {
    const organizationId = getOrganizationId(getState() as RootState);
    await callsApi.muteParticipant({ organizationId, callId, identity });
  },
);
