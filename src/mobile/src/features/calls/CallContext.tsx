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
  stopCallAudio,
  setSpeakerphoneOn,
} from "@features/calls/livekit";
import { callToPlain, type CallEndReason } from "@features/calls/callsSerializer";
import {
  buildRtcConfiguration,
  iceServersToPlain,
  type IceServerData,
} from "@features/calls/iceConfig";
import type { IceTransportPolicy } from "@uniffy/proto/calls/v1/calls_pb";
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
  speakerOn: boolean;
  secondDeviceMuted: boolean;
  connectedAtMs: number;
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
  clearEndedInfo: () => void;
  joinChannelCall: (channelId: string, media: JoinMediaOptions) => Promise<void>;
  joinCallById: (callId: string, channelId: string, media: JoinMediaOptions) => Promise<void>;
  leaveCall: () => Promise<void>;
  endCallForAll: () => Promise<void>;
  rejoin: () => Promise<void>;
  toggleMic: () => Promise<void>;
  toggleCamera: () => Promise<void>;
  flipCamera: () => Promise<void>;
  toggleSpeaker: () => Promise<void>;
}

const IDLE_SESSION: CallSession = {
  status: "idle",
  callId: null,
  channelId: null,
  micEnabled: false,
  cameraEnabled: false,
  speakerOn: false,
  secondDeviceMuted: false,
  connectedAtMs: 0,
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

  sessionRef.current = session;
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
        screenSharing: false,
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
        await connectRoom(
          {
            callId,
            channelId,
            wsUrl: response.wsUrl,
            livekitToken: response.livekitToken,
            serverMicEnabled: null,
            iceServers: iceServersToPlain(response.iceServers),
            iceTransportPolicy: response.iceTransportPolicy,
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
      setEndedInfo({ cause: lookupEndCause(callId), callId, channelId });
      setSession(IDLE_SESSION);
      setMinimized(false);
    } else {
      setSession((prev) => ({ ...prev, status: "disconnected" }));
      setEndedInfo({ cause: "CONNECTION_LOST", callId, channelId });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clearTimers, teardownRoom]);

  const lookupEndCause = useCallback(
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
        videoCaptureDefaults: { resolution: { width: 720, height: 1280 } },
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
        speakerOn: sessionRef.current.speakerOn || media.camera,
        secondDeviceMuted,
        connectedAtMs: Date.now(),
      });
      scheduleMediaReport();
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
      deliberateDisconnectRef.current = false;
      rejoinCancelledRef.current = false;
      setSession({ ...IDLE_SESSION, status: "connecting", channelId });
      try {
        const join = await request();
        await startCallAudio(media.camera);
        await connectRoom(join, media);
        setMinimized(false);
      } catch (error) {
        await resetToIdle();
        if (error instanceof ConnectError && error.code === Code.Unavailable) {
          setCallsDisabledMessage(error.rawMessage || "Calls are not available on this server");
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
    const s = sessionRef.current;
    await joinCallById(info.callId, info.channelId, {
      mic: s.micEnabled,
      camera: s.cameraEnabled,
    });
  }, [endedInfo, joinCallById]);

  const toggleMic = useCallback(async () => {
    const r = roomRef.current;
    if (!r) return;
    const next = !r.localParticipant.isMicrophoneEnabled;
    await r.localParticipant.setMicrophoneEnabled(next);
    setSession((prev) => ({ ...prev, micEnabled: next, secondDeviceMuted: false }));
    scheduleMediaReport();
  }, [scheduleMediaReport]);

  const toggleCamera = useCallback(async () => {
    const r = roomRef.current;
    if (!r) return;
    const next = !r.localParticipant.isCameraEnabled;
    await r.localParticipant.setCameraEnabled(next);
    setSession((prev) => ({ ...prev, cameraEnabled: next }));
    scheduleMediaReport();
  }, [scheduleMediaReport]);

  const flipCamera = useCallback(async () => {
    const r = roomRef.current;
    if (!r || !livekit) return;
    const publication = r.localParticipant.getTrackPublication(livekit.Track.Source.Camera);
    const track = publication?.track;
    if (!(track instanceof livekit.LocalVideoTrack)) return;
    const next = facingModeRef.current === "user" ? "environment" : "user";
    await track.restartTrack({ facingMode: next });
    facingModeRef.current = next;
  }, []);

  const toggleSpeaker = useCallback(async () => {
    const next = !sessionRef.current.speakerOn;
    await setSpeakerphoneOn(next).catch(() => {});
    setSession((prev) => ({ ...prev, speakerOn: next }));
  }, []);

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
    setCallsDisabledMessage(null);
  }, [organizationId, resetToIdle]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "background") return;
      const r = roomRef.current;
      if (r && sessionRef.current.status === "connected" && r.localParticipant.isCameraEnabled) {
        void r.localParticipant.setCameraEnabled(false).then(() => {
          setSession((prev) => ({ ...prev, cameraEnabled: false }));
          scheduleMediaReport();
        });
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
      clearEndedInfo,
      joinChannelCall,
      joinCallById,
      leaveCall,
      endCallForAll,
      rejoin,
      toggleMic,
      toggleCamera,
      flipCamera,
      toggleSpeaker,
    }),
    [
      callsDisabledMessage,
      session,
      room,
      endedInfo,
      minimized,
      clearEndedInfo,
      joinChannelCall,
      joinCallById,
      leaveCall,
      endCallForAll,
      rejoin,
      toggleMic,
      toggleCamera,
      flipCamera,
      toggleSpeaker,
    ],
  );

  return <CallContext.Provider value={value}>{children}</CallContext.Provider>;
}

export function useCall(): CallContextValue {
  const context = useContext(CallContext);
  if (!context) throw new Error("useCall must be used within CallProvider");
  return context;
}
