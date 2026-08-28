import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AppState } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { ConnectError, Code } from "@connectrpc/connect";
import type { ConnectionState, DisconnectReason, Room } from "livekit-client";
import { callsApi } from "@features/calls/callsApi";
import { getDeviceId, getDeviceLabel } from "@core/auth/deviceId";
import { resolveSignalingUrl } from "@features/calls/signalingUrl";
import { getTokenExpiryMs } from "@core/auth/jwt";
import {
  callsSupported,
  loadLivekitClient,
  setupLiveKit,
  startCallAudio,
  startCallMicService,
  stopCallAudio,
  selectAudioOutput,
} from "@features/calls/livekit";
import { callToPlain, type CallEndReason } from "@features/calls/callsSerializer";
import { callErrorMessage } from "@features/calls/callErrors";
import { getPreferredAudioOutput, getScreenShareQuality } from "@features/calls/callPrefs";
import { clampQuality, screenShareConfig } from "@features/calls/screenShareQuality";
import {
  clearCallMarker,
  readCallMarker,
  writeCallMarker,
  type CallSessionMarker,
} from "@features/calls/callSessionMarker";
import {
  buildRtcConfiguration,
  iceServersToPlain,
  type IceServerData,
} from "@features/calls/iceConfig";
import { ScreenShareQuality, type IceTransportPolicy } from "@uniffy/proto/calls/v1/calls_pb";
import {
  upsertActiveCall,
  lastEndedCallKey,
  type LastEndedCall,
} from "@features/calls/useCallsState";
import { useAuth } from "@core/providers/AuthContext";

setupLiveKit();
const livekit = loadLivekitClient();

const TOKEN_REFRESH_LEAD_MS = 10 * 60 * 1000;
const TOKEN_REFRESH_FLOOR_MS = 30 * 1000;
const REJOIN_WINDOW_MS = 90 * 1000;
const REJOIN_BASE_DELAY_MS = 2000;
const REJOIN_MAX_DELAY_MS = 15000;
const REPORT_DEBOUNCE_MS = 250;
const ENDED_REASON_FRESH_MS = 15 * 1000;

export type CallStatus = "idle" | "connecting" | "connected" | "reconnecting" | "disconnected";

export type CallEndCause = CallEndReason | "KICKED" | "CONNECTION_LOST";

export interface CallSession {
  status: CallStatus;
  callId: string | null;
  channelId: string | null;
  micEnabled: boolean;
  cameraEnabled: boolean;
  screenSharing: boolean;
  secondDeviceMuted: boolean;
  connectedAtMs: number;
  /** Org ceiling for screen-share quality, resolved server-side on join. */
  screenShareQualityCap: ScreenShareQuality;
  // Which physical camera the local capture is on. Doubles as a remount key for
  // the local self-view: restarting the track to flip cameras does not repaint
  // the native RTCView on its own, so the tile keys off this to force a fresh
  // view bound to the restarted track.
  cameraFacing: "user" | "environment";
}

export interface CallEndedInfo {
  cause: CallEndCause;
  callId: string;
  channelId: string;
}

export interface JoinMediaOptions {
  mic: boolean;
  camera: boolean;
}

interface CallContextValue {
  available: boolean;
  callsDisabledMessage: string | null;
  session: CallSession;
  room: Room | null;
  endedInfo: CallEndedInfo | null;
  minimized: boolean;
  setMinimized: (value: boolean) => void;
  /** A call this device was in that is still live after a cold start. */
  restorable: CallSessionMarker | null;
  restoreCall: () => Promise<void>;
  dismissRestore: () => void;
  clearEndedInfo: () => void;
  joinChannelCall: (channelId: string, media: JoinMediaOptions) => Promise<void>;
  joinCallById: (callId: string, channelId: string, media: JoinMediaOptions) => Promise<void>;
  leaveCall: () => Promise<void>;
  endCallForAll: () => Promise<void>;
  rejoin: () => Promise<void>;
  toggleMic: () => Promise<void>;
  toggleCamera: () => Promise<void>;
  toggleScreenShare: () => Promise<void>;
  flipCamera: () => Promise<void>;
}

const IDLE_SESSION: CallSession = {
  status: "idle",
  callId: null,
  channelId: null,
  micEnabled: false,
  cameraEnabled: false,
  screenSharing: false,
  secondDeviceMuted: false,
  connectedAtMs: 0,
  screenShareQualityCap: ScreenShareQuality.BALANCED,
  cameraFacing: "user",
};

const CallContext = createContext<CallContextValue | null>(null);

interface JoinResult {
  callId: string;
  channelId: string;
  wsUrl: string;
  livekitToken: string;
  serverMicEnabled: boolean | null;
  iceServers: IceServerData[];
  iceTransportPolicy: IceTransportPolicy;
  screenShareQualityCap: ScreenShareQuality;
}

function isCallGoneError(error: unknown): boolean {
  if (error instanceof ConnectError) {
    if (error.code === Code.NotFound) return true;
    return /call has ended|not found/i.test(error.rawMessage);
  }
  return false;
}

export function CallProvider({ children }: { children: React.ReactNode }) {
  const { user, organizationId, isAuthenticated } = useAuth();
  const queryClient = useQueryClient();

  const [session, setSession] = useState<CallSession>(IDLE_SESSION);
  const [room, setRoom] = useState<Room | null>(null);
  const [endedInfo, setEndedInfo] = useState<CallEndedInfo | null>(null);
  const [minimized, setMinimized] = useState(false);
  const [callsDisabledMessage, setCallsDisabledMessage] = useState<string | null>(null);
  const [restorable, setRestorable] = useState<CallSessionMarker | null>(null);

  const roomRef = useRef<Room | null>(null);
  const sessionRef = useRef<CallSession>(IDLE_SESSION);
  const orgRef = useRef<string | null>(organizationId);
  const deliberateDisconnectRef = useRef(false);
  const rejoiningRef = useRef(false);
  const rejoinCancelledRef = useRef(false);
  const facingModeRef = useRef<"user" | "environment">("user");
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reportTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reportInFlightRef = useRef(false);
  const reportPendingRef = useRef(false);
  const wasAuthedRef = useRef(isAuthenticated);
  const restoreCheckedForOrgRef = useRef<string | null>(null);

  // Mirrored during render rather than from an effect: LiveKit disconnect
  // handlers, the token-refresh timer and the rejoin loop all read these refs,
  // and any of them can fire before a passive effect would have flushed. Reading
  // a stale session there reports media for, or tears down, the wrong call.
  // eslint-disable-next-line react/react-compiler
  sessionRef.current = session;
  // eslint-disable-next-line react/react-compiler
  orgRef.current = organizationId;

  const clearTimers = useCallback(() => {
    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }
    if (reportTimerRef.current) {
      clearTimeout(reportTimerRef.current);
      reportTimerRef.current = null;
    }
  }, []);

  const teardownRoom = useCallback(async () => {
    const current = roomRef.current;
    roomRef.current = null;
    setRoom(null);
    if (current) {
      current.removeAllListeners();
      try {
        await current.disconnect();
      } catch {
        // Disconnect is best-effort during teardown.
      }
    }
  }, []);

  const resetToIdle = useCallback(async () => {
    rejoinCancelledRef.current = true;
    deliberateDisconnectRef.current = true;
    clearTimers();
    await teardownRoom();
    await stopCallAudio().catch(() => {});
    setSession(IDLE_SESSION);
    setMinimized(false);
    facingModeRef.current = "user";
    deliberateDisconnectRef.current = false;
  }, [clearTimers, teardownRoom]);

  // Re-enters itself once an in-flight report settles, so a toggle made during
  // the request still reaches the server. That self-reference is what the
  // compiler cannot model; the body reads only refs, so empty deps are correct
  // and the binding it calls is always this same instance.
  // eslint-disable-next-line react/react-compiler
  const sendMediaReport = useCallback(async () => {
    const r = roomRef.current;
    const s = sessionRef.current;
    const org = orgRef.current;
    if (!r || !s.callId || !org) return;
    if (reportInFlightRef.current) {
      reportPendingRef.current = true;
      return;
    }
    reportInFlightRef.current = true;
    try {
      await callsApi.reportMediaState({
        organizationId: org,
        callId: s.callId,
        deviceId: await getDeviceId(),
        micEnabled: r.localParticipant.isMicrophoneEnabled,
        cameraEnabled: r.localParticipant.isCameraEnabled,
        screenSharing: r.localParticipant.isScreenShareEnabled,
      });
    } catch {
      // Best-effort: the next toggle or snapshot resync re-reports.
    } finally {
      reportInFlightRef.current = false;
      if (reportPendingRef.current) {
        reportPendingRef.current = false;
        void sendMediaReport();
      }
    }
  }, []);

  const scheduleMediaReport = useCallback(() => {
    if (reportTimerRef.current) clearTimeout(reportTimerRef.current);
    reportTimerRef.current = setTimeout(() => {
      reportTimerRef.current = null;
      void sendMediaReport();
    }, REPORT_DEBOUNCE_MS);
  }, [sendMediaReport]);

  // Re-arms itself for the token that comes back, since each token's own expiry
  // sets the next deadline, and the retry path re-arms itself the same way. Those
  // self-references are what the compiler cannot model; the body reads only refs,
  // so empty deps are correct and the bindings it calls are always this instance.
  /* eslint-disable react/react-compiler */
  const scheduleTokenRefresh = useCallback((token: string) => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    const expiryMs = getTokenExpiryMs(token);
    if (!expiryMs) return;
    const delay = Math.max(expiryMs - Date.now() - TOKEN_REFRESH_LEAD_MS, TOKEN_REFRESH_FLOOR_MS);
    const refreshNow = async () => {
      refreshTimerRef.current = null;
      const s = sessionRef.current;
      const org = orgRef.current;
      if (!s.callId || !org) return;
      try {
        const response = await callsApi.refreshCallToken({
          organizationId: org,
          callId: s.callId,
          deviceId: await getDeviceId(),
        });
        scheduleTokenRefresh(response.livekitToken);
      } catch {
        // Retry shortly; a dead call surfaces through disconnect anyway.
        refreshTimerRef.current = setTimeout(() => void refreshNow(), 60 * 1000);
      }
    };
    refreshTimerRef.current = setTimeout(() => void refreshNow(), delay);
  }, []);
  /* eslint-enable react/react-compiler */

  const attemptRejoin = useCallback(async () => {
    const s = sessionRef.current;
    const org = orgRef.current;
    if (rejoiningRef.current || !s.callId || !s.channelId || !org) return;
    rejoiningRef.current = true;
    rejoinCancelledRef.current = false;
    const { callId, channelId, micEnabled, cameraEnabled } = s;
    setSession((prev) => ({ ...prev, status: "reconnecting" }));
    await teardownRoom();

    const deadline = Date.now() + REJOIN_WINDOW_MS;
    let delay = REJOIN_BASE_DELAY_MS;
    let callGone = false;
    while (Date.now() < deadline && !rejoinCancelledRef.current) {
      try {
        const deviceId = await getDeviceId();
        const response = await callsApi.joinCall({
          organizationId: org,
          callId,
          deviceId,
          deviceLabel: getDeviceLabel(),
        });
        if (rejoinCancelledRef.current) break;
        // connectRoom and lookupEndCause below are declared later in this
        // component: handleDisconnected -> attemptRejoin -> connectRoom ->
        // handleDisconnected is a genuine cycle, so one edge has to read ahead.
        // Every callback in it is built from refs or stable deps, so this
        // closure's captures are never stale, and keeping them out of the deps
        // is deliberate - a churning attemptRejoin would rebuild
        // handleDisconnected, which is a live listener on the LiveKit room.
        // eslint-disable-next-line react/react-compiler
        await connectRoom(
          {
            callId,
            channelId,
            wsUrl: response.wsUrl,
            livekitToken: response.livekitToken,
            serverMicEnabled: null,
            iceServers: iceServersToPlain(response.iceServers),
            iceTransportPolicy: response.iceTransportPolicy,
            screenShareQualityCap: response.screenShareQualityCap,
          },
          { mic: micEnabled, camera: cameraEnabled },
        );
        rejoiningRef.current = false;
        return;
      } catch (error) {
        if (isCallGoneError(error)) {
          callGone = true;
          break;
        }
      }
      // Jitter desynchronizes rejoin attempts across devices after a media
      // server restart drops every participant at once.
      await new Promise((resolve) =>
        setTimeout(resolve, Math.round(delay * (0.75 + Math.random() * 0.5))),
      );
      delay = Math.min(delay * 2, REJOIN_MAX_DELAY_MS);
    }

    rejoiningRef.current = false;
    if (rejoinCancelledRef.current) return;
    clearTimers();
    await stopCallAudio().catch(() => {});
    if (callGone) {
      // eslint-disable-next-line react/react-compiler
      setEndedInfo({ cause: lookupEndCause(callId), callId, channelId });
      setSession(IDLE_SESSION);
      setMinimized(false);
    } else {
      setSession((prev) => ({ ...prev, status: "disconnected" }));
      setEndedInfo({ cause: "CONNECTION_LOST", callId, channelId });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clearTimers, teardownRoom]);

  // Read by attemptRejoin above, which is the read-ahead edge of the rejoin
  // cycle; that is what stops the compiler from preserving this memo.
  // `queryClient` is stable for the app's lifetime, so this callback is too.
  const lookupEndCause = useCallback(
    // eslint-disable-next-line react/react-compiler
    (callId: string): CallEndCause => {
      const org = orgRef.current;
      if (!org) return "UNKNOWN";
      const ended = queryClient.getQueryData<LastEndedCall>(lastEndedCallKey(org));
      if (ended && ended.callId === callId && Date.now() - ended.atMs < ENDED_REASON_FRESH_MS) {
        return ended.reason;
      }
      return "UNKNOWN";
    },
    [queryClient],
  );

  const handleDisconnected = useCallback(
    (reason?: DisconnectReason) => {
      if (!livekit || deliberateDisconnectRef.current) return;
      const s = sessionRef.current;
      if (!s.callId || !s.channelId) return;
      const finish = (cause: CallEndCause | null) => {
        clearTimers();
        void teardownRoom();
        void stopCallAudio().catch(() => {});
        void clearCallMarker();
        if (cause) setEndedInfo({ cause, callId: s.callId!, channelId: s.channelId! });
        setSession(IDLE_SESSION);
        setMinimized(false);
      };
      switch (reason) {
        case livekit.DisconnectReason.CLIENT_INITIATED:
          break;
        case livekit.DisconnectReason.PARTICIPANT_REMOVED:
          finish("KICKED");
          break;
        case livekit.DisconnectReason.ROOM_DELETED:
          finish(lookupEndCause(s.callId));
          break;
        case livekit.DisconnectReason.DUPLICATE_IDENTITY:
          finish(null);
          break;
        default:
          void attemptRejoin();
          break;
      }
    },
    [attemptRejoin, clearTimers, lookupEndCause, teardownRoom],
  );

  const connectRoom = useCallback(
    async (join: JoinResult, media: JoinMediaOptions) => {
      if (!livekit) throw new Error("Calls are not supported on this platform");
      // Portrait capture: the default landscape presets get center-cropped
      // into portrait tiles, which reads as a heavy zoom on phones.
      const r = new livekit.Room({
        // adaptiveStream pauses remote tracks whose view size it cannot resolve.
        // On React Native the VideoView often cannot report dimensions ("could
        // not determine track dimensions"), so remote video - screen shares in
        // particular - never requests frames and renders black. Off = frames
        // always flow; fine for small calls.
        adaptiveStream: false,
        // livekit-client defaults to single-peer-connection mode (2.17+), which
        // still has React Native bugs: remote tracks negotiate (ontrack fires)
        // but frames never render on iOS. RN-specific SDP fixes were still
        // landing at 2.20.x (livekit/client-sdk-js#1984, #1993), so pin the
        // mature dual peer connection path.
        singlePeerConnection: false,
        dynacast: true,
        // Capture the front sensor's native 3:4 (portrait) frame. A 9:16 hint
        // made the S24 hand back a 1:1 center-crop, which reads as a heavy zoom;
        // 3:4 uses the full sensor width for a wider, less "in your face" view.
        videoCaptureDefaults: { resolution: { width: 960, height: 1280 } },
      });
      roomRef.current = r;

      r.on(livekit.RoomEvent.Disconnected, (reason?: DisconnectReason) => {
        if (roomRef.current !== r) return;
        handleDisconnected(reason);
      });
      r.on(livekit.RoomEvent.ConnectionStateChanged, (state: ConnectionState) => {
        if (roomRef.current !== r) return;
        if (
          state === livekit.ConnectionState.Reconnecting ||
          state === livekit.ConnectionState.SignalReconnecting
        ) {
          setSession((prev) =>
            prev.status === "connected" ? { ...prev, status: "reconnecting" } : prev,
          );
        } else if (state === livekit.ConnectionState.Connected) {
          setSession((prev) =>
            prev.status === "reconnecting" ? { ...prev, status: "connected" } : prev,
          );
        }
      });
      const syncLocalMedia = () => {
        if (roomRef.current !== r) return;
        setSession((prev) => ({
          ...prev,
          micEnabled: r.localParticipant.isMicrophoneEnabled,
          cameraEnabled: r.localParticipant.isCameraEnabled,
        }));
        scheduleMediaReport();
      };
      r.on(livekit.RoomEvent.TrackMuted, (_publication, participant) => {
        if (participant.isLocal) syncLocalMedia();
      });
      r.on(livekit.RoomEvent.TrackUnmuted, (_publication, participant) => {
        if (participant.isLocal) syncLocalMedia();
      });
      // The screen share can also be stopped from the Android notification shade,
      // which never goes through our toggle - the publication events are the only
      // place that stop is observable.
      const syncScreenShare = (sharing: boolean) => {
        if (roomRef.current !== r) return;
        setSession((prev) => ({ ...prev, screenSharing: sharing }));
        scheduleMediaReport();
      };
      r.on(livekit.RoomEvent.LocalTrackPublished, (publication) => {
        if (publication.source === livekit.Track.Source.ScreenShare) syncScreenShare(true);
      });
      r.on(livekit.RoomEvent.LocalTrackUnpublished, (publication) => {
        if (publication.source === livekit.Track.Source.ScreenShare) syncScreenShare(false);
      });

      const url = resolveSignalingUrl(join.wsUrl);
      await r.connect(url, join.livekitToken, {
        rtcConfig: buildRtcConfiguration(join.iceServers, join.iceTransportPolicy),
      });
      scheduleTokenRefresh(join.livekitToken);

      // A second device joins force-muted server-side; honor it on connect.
      const effectiveMic = media.mic && join.serverMicEnabled !== false;
      const secondDeviceMuted = media.mic && join.serverMicEnabled === false;
      try {
        if (effectiveMic) await r.localParticipant.setMicrophoneEnabled(true);
        if (media.camera) await r.localParticipant.setCameraEnabled(true);
      } catch {
        // Permission or device failure: stay in the call listen-only.
      }

      setRoom(r);
      setSession({
        status: "connected",
        callId: join.callId,
        channelId: join.channelId,
        micEnabled: r.localParticipant.isMicrophoneEnabled,
        cameraEnabled: r.localParticipant.isCameraEnabled,
        screenSharing: false,
        secondDeviceMuted,
        connectedAtMs: Date.now(),
        screenShareQualityCap: join.screenShareQualityCap,
        cameraFacing: "user",
      });
      scheduleMediaReport();
      // Continuity marker: the process can be killed without any teardown running,
      // so the marker is what a cold start has to go on.
      void writeCallMarker({
        callId: join.callId,
        channelId: join.channelId,
        micEnabled: r.localParticipant.isMicrophoneEnabled,
        cameraEnabled: r.localParticipant.isCameraEnabled,
        ts: Date.now(),
      });
    },
    [handleDisconnected, scheduleMediaReport, scheduleTokenRefresh],
  );

  const startJoin = useCallback(
    async (request: () => Promise<JoinResult>, channelId: string, media: JoinMediaOptions) => {
      if (!callsSupported) throw new Error("Calls are not supported on this platform");
      const current = sessionRef.current;
      if (current.status !== "idle" && current.channelId === channelId) {
        setMinimized(false);
        return;
      }
      if (current.status !== "idle") {
        throw new Error("Already in a call - leave it before joining another");
      }
      setEndedInfo(null);
      setRestorable(null);
      deliberateDisconnectRef.current = false;
      rejoinCancelledRef.current = false;
      setSession({ ...IDLE_SESSION, status: "connecting", channelId });
      try {
        const join = await request();
        await startCallAudio(media.camera, media.mic);
        // The route list only exists once the session is running, so a remembered
        // choice can only be re-applied here rather than as part of configuring.
        const preferredOutput = await getPreferredAudioOutput();
        if (preferredOutput) await selectAudioOutput(preferredOutput).catch(() => {});
        await connectRoom(join, media);
        setMinimized(false);
      } catch (error) {
        await resetToIdle();
        // UNAVAILABLE is a deployment with no LiveKit; PERMISSION_DENIED is an org
        // that turned calls off. Both mean "not now, and not because of this tap",
        // so the reason is kept for the surface that replaces the call button.
        if (
          error instanceof ConnectError &&
          (error.code === Code.Unavailable || error.code === Code.PermissionDenied)
        ) {
          setCallsDisabledMessage(callErrorMessage(error));
        }
        throw error;
      }
    },
    [connectRoom, resetToIdle],
  );

  const joinChannelCall = useCallback(
    async (channelId: string, media: JoinMediaOptions) => {
      await startJoin(
        async () => {
          const org = orgRef.current;
          if (!org) throw new Error("No organization selected");
          const response = await callsApi.initiateCall({
            organizationId: org,
            channelId,
            deviceId: await getDeviceId(),
            deviceLabel: getDeviceLabel(),
          });
          if (response.call) upsertActiveCall(queryClient, org, callToPlain(response.call));
          const ownIdentity = `${user?.id}:${await getDeviceId()}`;
          const ownRow = response.call?.participants.find((p) => p.identity === ownIdentity);
          return {
            callId: response.call?.id ?? "",
            channelId,
            wsUrl: response.wsUrl,
            livekitToken: response.livekitToken,
            serverMicEnabled: ownRow ? ownRow.micEnabled : null,
            iceServers: iceServersToPlain(response.iceServers),
            iceTransportPolicy: response.iceTransportPolicy,
            screenShareQualityCap: response.screenShareQualityCap,
          };
        },
        channelId,
        media,
      );
    },
    [queryClient, startJoin, user?.id],
  );

  const joinCallById = useCallback(
    async (callId: string, channelId: string, media: JoinMediaOptions) => {
      await startJoin(
        async () => {
          const org = orgRef.current;
          if (!org) throw new Error("No organization selected");
          const response = await callsApi.joinCall({
            organizationId: org,
            callId,
            deviceId: await getDeviceId(),
            deviceLabel: getDeviceLabel(),
          });
          if (response.call) upsertActiveCall(queryClient, org, callToPlain(response.call));
          const ownIdentity = `${user?.id}:${await getDeviceId()}`;
          const ownRow = response.call?.participants.find((p) => p.identity === ownIdentity);
          return {
            callId,
            channelId,
            wsUrl: response.wsUrl,
            livekitToken: response.livekitToken,
            serverMicEnabled: ownRow ? ownRow.micEnabled : null,
            iceServers: iceServersToPlain(response.iceServers),
            iceTransportPolicy: response.iceTransportPolicy,
            screenShareQualityCap: response.screenShareQualityCap,
          };
        },
        channelId,
        media,
      );
    },
    [queryClient, startJoin, user?.id],
  );

  const leaveCall = useCallback(async () => {
    const s = sessionRef.current;
    const org = orgRef.current;
    const callId = s.callId;
    void clearCallMarker();
    await resetToIdle();
    if (callId && org) {
      try {
        await callsApi.leaveCall({
          organizationId: org,
          callId,
          deviceId: await getDeviceId(),
        });
      } catch {
        // Idempotent server-side; the webhook and reconciler self-heal.
      }
    }
  }, [resetToIdle]);

  const endCallForAll = useCallback(async () => {
    const s = sessionRef.current;
    const org = orgRef.current;
    const callId = s.callId;
    void clearCallMarker();
    await resetToIdle();
    if (callId && org) {
      try {
        await callsApi.endCall({ organizationId: org, callId });
      } catch {
        // Permission errors surface via the roster staying live.
      }
    }
  }, [resetToIdle]);

  const rejoin = useCallback(async () => {
    const info = endedInfo;
    if (!info) return;
    setEndedInfo(null);
    // A lost connection parks the session at "disconnected" on the same channel,
    // which startJoin reads as "already in this call" and returns early from. The
    // media intent has to be captured before the reset clears it.
    const { micEnabled, cameraEnabled } = sessionRef.current;
    sessionRef.current = IDLE_SESSION;
    setSession(IDLE_SESSION);
    setMinimized(false);
    try {
      await joinCallById(info.callId, info.channelId, {
        mic: micEnabled,
        camera: cameraEnabled,
      });
    } catch {
      // startJoin already resets to idle and surfaces any disabled-call message.
    }
  }, [endedInfo, joinCallById]);

  const toggleMic = useCallback(async () => {
    const r = roomRef.current;
    if (!r) return;
    const next = !r.localParticipant.isMicrophoneEnabled;
    try {
      await r.localParticipant.setMicrophoneEnabled(next);
    } catch {
      // Device/permission failure: leave the mic state untouched.
      return;
    }
    // A call joined listen-only has no microphone service yet; unmuting is the
    // first moment the app holds RecordAudio and may start one. It stays up for
    // the rest of the call, since muting again does not drop the permission.
    if (next) startCallMicService();
    setSession((prev) => ({ ...prev, micEnabled: next, secondDeviceMuted: false }));
    scheduleMediaReport();
  }, [scheduleMediaReport]);

  const toggleCamera = useCallback(async () => {
    const r = roomRef.current;
    if (!r) return;
    const next = !r.localParticipant.isCameraEnabled;
    try {
      await r.localParticipant.setCameraEnabled(next);
    } catch {
      // Device/permission failure: leave the camera state untouched.
      return;
    }
    setSession((prev) => ({ ...prev, cameraEnabled: next }));
    scheduleMediaReport();
  }, [scheduleMediaReport]);

  const toggleScreenShare = useCallback(async () => {
    const r = roomRef.current;
    if (!r) return;
    const next = !r.localParticipant.isScreenShareEnabled;
    const tier = clampQuality(
      await getScreenShareQuality(),
      sessionRef.current.screenShareQualityCap,
    );
    const config = screenShareConfig(tier);
    try {
      // No capture options: React Native's getDisplayMedia takes no arguments, so
      // the org limit can only be applied to what gets published, not to what the
      // system hands us.
      await r.localParticipant.setScreenShareEnabled(next, undefined, {
        screenShareEncoding: config.encoding,
        screenShareSimulcastLayers: config.simulcastLayers,
      });
    } catch {
      // The user declined the system capture consent dialog.
      return;
    }
    setSession((prev) => ({ ...prev, screenSharing: next }));
    scheduleMediaReport();
  }, [scheduleMediaReport]);

  const flipCamera = useCallback(async () => {
    const r = roomRef.current;
    if (!r || !livekit) return;
    const publication = r.localParticipant.getTrackPublication(livekit.Track.Source.Camera);
    const track = publication?.track;
    if (!(track instanceof livekit.LocalVideoTrack)) return;
    const next = facingModeRef.current === "user" ? "environment" : "user";
    // restartTrack is the only method that actually re-opens the other physical
    // lens on this device: _switchCamera / applyConstraints({ facingMode }) just
    // re-apply constraints to the running capture and never switch cameras. The
    // catch is that a bare restart freezes the local self-view (the native
    // RTCView keeps the pre-restart frame and never repaints), so cameraFacing is
    // pushed into state - the local tile keys off it and remounts onto the fresh
    // track. The remote side updates on its own from the republished track.
    try {
      await track.restartTrack({ facingMode: next });
    } catch {
      return;
    }
    facingModeRef.current = next;
    setSession((prev) => ({ ...prev, cameraFacing: next }));
  }, []);

  const dismissRestore = useCallback(() => {
    setRestorable(null);
    void clearCallMarker();
  }, []);

  const restoreCall = useCallback(async () => {
    const marker = restorable;
    if (!marker) return;
    setRestorable(null);
    try {
      // Mic and camera stay off: the user is coming back cold and has not said
      // what they want published, only that they want to be in the call again.
      await joinCallById(marker.callId, marker.channelId, { mic: false, camera: false });
    } catch {
      await clearCallMarker();
    }
  }, [restorable, joinCallById]);

  const clearEndedInfo = useCallback(() => {
    setEndedInfo(null);
    if (sessionRef.current.status === "disconnected") {
      setSession(IDLE_SESSION);
      setMinimized(false);
    }
  }, []);

  // The provider never unmounts, so identity and org teardown are explicit: a
  // room left connected keeps transmitting the mic behind stale UI.
  useEffect(() => {
    if (wasAuthedRef.current && !isAuthenticated && sessionRef.current.status !== "idle") {
      void resetToIdle();
      setEndedInfo(null);
    }
    wasAuthedRef.current = isAuthenticated;
  }, [isAuthenticated, resetToIdle]);

  const prevOrgForTeardownRef = useRef(organizationId);
  useEffect(() => {
    if (
      prevOrgForTeardownRef.current &&
      organizationId !== prevOrgForTeardownRef.current &&
      sessionRef.current.status !== "idle"
    ) {
      void resetToIdle();
      setEndedInfo(null);
    }
    prevOrgForTeardownRef.current = organizationId;
    // The banner records why THIS org refused a call, so switching orgs has to
    // drop it. The provider deliberately never unmounts, so a remount key is not
    // available here and the reset has to be explicit.
    // eslint-disable-next-line react/react-compiler
    setCallsDisabledMessage(null);
  }, [organizationId, resetToIdle]);

  // Cold start after the process was killed mid-call. The marker names a call and
  // the server says whether it is still running; only then is a rejoin offered.
  // Every write here lands after an await, so the effect adjusts no state
  // synchronously.
  useEffect(() => {
    if (!organizationId || !isAuthenticated) return;
    if (restoreCheckedForOrgRef.current === organizationId) return;
    restoreCheckedForOrgRef.current = organizationId;
    void (async () => {
      setRestorable(null);
      const marker = await readCallMarker();
      if (!marker || sessionRef.current.status !== "idle") return;
      try {
        const response = await callsApi.getActiveCall({
          organizationId,
          channelId: marker.channelId,
        });
        if (response.call?.id === marker.callId) {
          setRestorable(marker);
          return;
        }
        await clearCallMarker();
      } catch {
        // Leave the marker alone: a transient failure must not strand the user out
        // of a call that is still running, and the TTL bounds how long it retries.
      }
    })();
  }, [organizationId, isAuthenticated]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "background") return;
      const r = roomRef.current;
      const s = sessionRef.current;
      // Backgrounding is the moment before the OS may kill the process, and it is
      // also where the marker's age starts mattering, so refresh its timestamp.
      if (r && s.status === "connected" && s.callId && s.channelId) {
        void writeCallMarker({
          callId: s.callId,
          channelId: s.channelId,
          micEnabled: r.localParticipant.isMicrophoneEnabled,
          cameraEnabled: r.localParticipant.isCameraEnabled,
          ts: Date.now(),
        });
      }
      if (r && sessionRef.current.status === "connected" && r.localParticipant.isCameraEnabled) {
        void r.localParticipant
          .setCameraEnabled(false)
          .then(() => {
            setSession((prev) => ({ ...prev, cameraEnabled: false }));
            scheduleMediaReport();
          })
          .catch(() => {});
      }
    });
    return () => subscription.remove();
  }, [scheduleMediaReport]);

  useEffect(() => {
    if (session.status === "connected") {
      void activateKeepAwakeAsync("call").catch(() => {});
      return () => {
        deactivateKeepAwake("call").catch(() => {});
      };
    }
    return undefined;
  }, [session.status]);

  useEffect(() => {
    return () => {
      void resetToIdle();
    };
  }, [resetToIdle]);

  const value = useMemo<CallContextValue>(
    () => ({
      available: callsSupported && !callsDisabledMessage,
      callsDisabledMessage,
      session,
      room,
      endedInfo,
      minimized,
      setMinimized,
      restorable,
      restoreCall,
      dismissRestore,
      clearEndedInfo,
      joinChannelCall,
      joinCallById,
      leaveCall,
      endCallForAll,
      rejoin,
      toggleMic,
      toggleCamera,
      toggleScreenShare,
      flipCamera,
    }),
    [
      callsDisabledMessage,
      session,
      room,
      endedInfo,
      minimized,
      restorable,
      restoreCall,
      dismissRestore,
      clearEndedInfo,
      joinChannelCall,
      joinCallById,
      leaveCall,
      endCallForAll,
      rejoin,
      toggleMic,
      toggleCamera,
      toggleScreenShare,
      flipCamera,
    ],
  );

  return <CallContext.Provider value={value}>{children}</CallContext.Provider>;
}

export function useCall(): CallContextValue {
  const context = useContext(CallContext);
  if (!context) throw new Error("useCall must be used within CallProvider");
  return context;
}
