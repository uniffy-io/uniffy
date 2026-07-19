import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ConnectionState,
  DisconnectReason,
  Room,
  RoomEvent,
  Track,
  createLocalAudioTrack,
} from 'livekit-client';
import { toast } from 'sonner';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import {
  callUpserted,
  clearCalls,
  localMediaChanged,
  selectCallSession,
  selectEndedInfo,
  selectSessionCall,
  sessionConnected,
  sessionConnecting,
  sessionDisconnected,
  sessionReconnecting,
  sessionReset,
} from '@/features/calls/store/callsSlice';
import {
  endCall as endCallThunk,
  fetchActiveCall,
  initiateCall,
  joinCall,
  joinCallRequest,
  leaveCall,
  refreshCallToken,
} from '@/features/calls/store/callsThunks';
import { selectCallPreferences } from '@/features/calls/store/callPreferencesSlice';
import { callsApi } from '@/features/calls/api/callsApi';
import { resolveSignalingUrl } from '@/features/calls/utils/signalingUrl';
import { buildRtcConfiguration } from '@/features/calls/utils/iceConfig';
import { getTokenExpiryMs } from '@/features/calls/utils/livekitToken';
import {
  clearCallMarkers,
  consumeSessionMarker,
  readRecentMarker,
  writeCallMarkers,
} from '@/features/calls/utils/sessionMarkers';
import { getDeviceId } from '@/shared/utils/deviceId';
import { env } from '@/config/env';
import { getAccessToken } from '@/config/api';
import { CallContext } from '@/features/calls/components/callContext';
import { clampQuality, screenShareConfig } from '@/features/calls/utils/screenShareQuality';
import { ScreenShareQuality } from '@uniffy/proto/calls/v1/calls_pb';
import type { CallJoinResult } from '@/features/calls/store/callsThunks';
import type {
  CallContextValue,
  JoinMediaOptions,
} from '@/features/calls/components/callContext';

const TOKEN_REFRESH_LEAD_MS = 10 * 60 * 1000;
const REJOIN_WINDOW_MS = 90_000;
const REJOIN_BASE_DELAY_MS = 2_000;
const REJOIN_MAX_DELAY_MS = 15_000;
const ROSTER_KICK_GRACE_MS = 5_000;
const TAB_PROBE_TIMEOUT_MS = 300;

/** Backoff sleep that wakes early when the browser regains connectivity. */
function sleepOrOnline(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      window.removeEventListener('online', done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    window.addEventListener('online', done);
  });
}

/**
 * LeaveCall during pagehide. The ConnectRPC client cannot run in an unloading
 * document; a raw keepalive fetch against the Connect JSON endpoint can.
 * sendBeacon is out: it cannot carry the Authorization header.
 */
function sendLeaveBeacon(organizationId: string, callId: string): void {
  const token = getAccessToken();
  if (!token) return;
  try {
    void fetch(`${env.apiBaseUrl}/calls.v1.CallService/LeaveCall`, {
      method: 'POST',
      keepalive: true,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ organizationId, callId, deviceId: getDeviceId() }),
    });
  } catch {
    // Best-effort; the participant_left webhook is the fallback.
  }
}

function isCallGoneError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /call has ended|not found/i.test(message);
}

type TabMessage =
  | { type: 'probe'; nonce: string }
  | { type: 'active'; nonce: string }
  | { type: 'focus' };

/** Same-browser tabs share a device_id; only one of them may hold the call. */
function useCallTabChannel(isInCall: () => boolean) {
  const channelRef = useRef<BroadcastChannel | null>(null);

  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    const bc = new BroadcastChannel('uniffy-call-tab');
    channelRef.current = bc;
    bc.onmessage = (e: MessageEvent<TabMessage>) => {
      const msg = e.data;
      if (msg.type === 'probe' && isInCall()) {
        bc.postMessage({ type: 'active', nonce: msg.nonce } satisfies TabMessage);
      } else if (msg.type === 'focus' && isInCall()) {
        window.focus();
      }
    };
    return () => {
      bc.close();
      channelRef.current = null;
    };
  }, [isInCall]);

  const probeOtherTab = useCallback(async (): Promise<boolean> => {
    const bc = channelRef.current;
    if (!bc) return false;
    const nonce = Math.random().toString(36).slice(2);
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        bc.removeEventListener('message', onMessage);
        resolve(false);
      }, TAB_PROBE_TIMEOUT_MS);
      const onMessage = (e: MessageEvent<TabMessage>) => {
        if (e.data.type === 'active' && e.data.nonce === nonce) {
          clearTimeout(timer);
          bc.removeEventListener('message', onMessage);
          resolve(true);
        }
      };
      bc.addEventListener('message', onMessage);
      bc.postMessage({ type: 'probe', nonce } satisfies TabMessage);
    });
  }, []);

  const requestFocus = useCallback(() => {
    channelRef.current?.postMessage({ type: 'focus' } satisfies TabMessage);
  }, []);

  return { probeOtherTab, requestFocus };
}

export function CallProvider({ children }: { children: React.ReactNode }) {
  const dispatch = useAppDispatch();
  const session = useAppSelector(selectCallSession);
  const sessionCall = useAppSelector(selectSessionCall);
  const preferences = useAppSelector(selectCallPreferences);
  const currentUserId = useAppSelector((s) => s.auth.user?.id ?? '');
  const currentOrgId = useAppSelector((s) => s.auth.currentOrganizationId);
  const endedInfo = useAppSelector(selectEndedInfo);

  const [room, setRoom] = useState<Room | null>(null);
  const roomRef = useRef<Room | null>(null);
  const tokenRef = useRef<string | null>(null);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reportTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reportInFlightRef = useRef(false);
  const reportPendingRef = useRef(false);
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const preferencesRef = useRef(preferences);
  preferencesRef.current = preferences;
  const screenShareCapRef = useRef<ScreenShareQuality>(ScreenShareQuality.BALANCED);
  const orgIdRef = useRef(currentOrgId);
  orgIdRef.current = currentOrgId;
  const rejoiningRef = useRef(false);
  const everConnectedRef = useRef(false);
  const connectedAtRef = useRef(0);
  const restoreAttemptedRef = useRef(false);

  const isInCall = useCallback(
    () => sessionRef.current.status === 'connected' || sessionRef.current.status === 'reconnecting',
    [],
  );
  const { probeOtherTab, requestFocus } = useCallTabChannel(isInCall);

  const clearRefreshTimer = useCallback(() => {
    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }
  }, []);

  const teardown = useCallback(async () => {
    clearRefreshTimer();
    if (reportTimerRef.current) {
      clearTimeout(reportTimerRef.current);
      reportTimerRef.current = null;
    }
    reportPendingRef.current = false;
    tokenRef.current = null;
    const r = roomRef.current;
    roomRef.current = null;
    setRoom(null);
    if (r) {
      try {
        await r.disconnect();
      } catch {
        // Already disconnected.
      }
    }
  }, [clearRefreshTimer]);

  // LiveKit emits no mute webhook, so the backend cannot infer mic state. The
  // client is the roster's source of truth for mic/camera/screen. Reports
  // serialize: at most one in flight, and a change arriving mid-flight queues a
  // single trailing send that re-reads live state. Two reports never overlap, so
  // the backend cannot commit them out of order - last-write-wins holds across
  // bursts, not only within the debounce window. Best-effort; failures never toast.
  const sendMediaReport = useCallback(async () => {
    if (reportInFlightRef.current) {
      reportPendingRef.current = true;
      return;
    }
    reportInFlightRef.current = true;
    try {
      for (;;) {
        const r = roomRef.current;
        const { callId } = sessionRef.current;
        const organizationId = orgIdRef.current;
        if (!r || !callId || !organizationId) break;
        try {
          await callsApi.reportMediaState({
            organizationId,
            callId,
            deviceId: getDeviceId(),
            micEnabled: r.localParticipant.isMicrophoneEnabled,
            cameraEnabled: r.localParticipant.isCameraEnabled,
            screenSharing: r.localParticipant.isScreenShareEnabled,
          });
        } catch {
          // The next change or stream resync re-reports.
        }
        if (!reportPendingRef.current) break;
        reportPendingRef.current = false;
      }
    } finally {
      reportInFlightRef.current = false;
    }
  }, []);

  const reportMediaState = useCallback(() => {
    if (reportTimerRef.current) clearTimeout(reportTimerRef.current);
    reportTimerRef.current = setTimeout(() => {
      reportTimerRef.current = null;
      void sendMediaReport();
    }, 250);
  }, [sendMediaReport]);

  const scheduleTokenRefresh = useCallback(
    (token: string, callId: string) => {
      clearRefreshTimer();
      const expiry = getTokenExpiryMs(token);
      if (!expiry) return;
      const delay = Math.max(expiry - Date.now() - TOKEN_REFRESH_LEAD_MS, 30_000);
      refreshTimerRef.current = setTimeout(async () => {
        try {
          // The backend blacklists the previous jti on refresh. The SDK's own
          // full-reconnect would replay the stale token and get kicked, so any
          // disconnect after this point goes through our JoinCall rejoin path,
          // which always mints a fresh token.
          const newToken = await dispatch(refreshCallToken(callId)).unwrap();
          tokenRef.current = newToken;
          scheduleTokenRefresh(newToken, callId);
        } catch {
          // Refresh failure is non-fatal while connected; rejoin re-mints.
        }
      }, delay);
    },
    [clearRefreshTimer, dispatch],
  );

  const publishInitialMedia = useCallback(
    async (r: Room, opts: JoinMediaOptions) => {
      const prefs = preferencesRef.current;
      let micEnabled = false;
      let cameraEnabled = false;
      try {
        if (opts.micEnabled) {
          await r.localParticipant.setMicrophoneEnabled(true, {
            deviceId: prefs.audioInputId ?? undefined,
          });
          micEnabled = true;
        } else {
          // The participant row defaults to mic-on server-side; the initial
          // reportMediaState below corrects the roster. Publishing a pre-muted
          // track keeps the mic session warm; capture stops on mute, so nothing
          // is transmitted.
          const track = await createLocalAudioTrack({
            deviceId: prefs.audioInputId ?? undefined,
          });
          await track.mute();
          await r.localParticipant.publishTrack(track, {
            source: Track.Source.Microphone,
          });
        }
      } catch {
        // Mic permission denied: listen-only mode.
      }
      try {
        if (opts.cameraEnabled) {
          await r.localParticipant.setCameraEnabled(true, {
            deviceId: prefs.videoInputId ?? undefined,
          });
          cameraEnabled = true;
        }
      } catch {
        // Camera permission denied; keep the call audio-only.
      }
      dispatch(localMediaChanged({ micEnabled, cameraEnabled, screenSharing: false }));
      reportMediaState();
    },
    [dispatch, reportMediaState],
  );

  const connectRoomRef = useRef<
    ((result: CallJoinResult, opts: JoinMediaOptions) => Promise<void>) | null
  >(null);

  const attemptRejoin = useCallback(async () => {
    const { callId, channelId } = sessionRef.current;
    if (!callId || !channelId || rejoiningRef.current) return;
    rejoiningRef.current = true;
    dispatch(sessionReconnecting());
    try {
      const deadline = Date.now() + REJOIN_WINDOW_MS;
      let delay = REJOIN_BASE_DELAY_MS;
      while (Date.now() < deadline) {
        // The user left, or CALL_ENDED reset the session mid-loop.
        if (sessionRef.current.status !== 'reconnecting') return;
        try {
          // Bypass the joinCall thunk so a failed attempt is not a rejected
          // action the error-toast middleware turns into a "could not connect"
          // toast on every one of the loop's iterations.
          const result = await joinCallRequest(orgIdRef.current ?? '', callId);
          dispatch(callUpserted(result.call));
          await connectRoomRef.current?.(result, {
            micEnabled: sessionRef.current.micEnabled,
            cameraEnabled: sessionRef.current.cameraEnabled,
          });
          // A drop during connectRoom's media publish fires Disconnected while
          // rejoiningRef is still set, so handleDisconnected swallows it. Only
          // finish once the fresh room actually stayed connected; otherwise fall
          // through and retry instead of returning to a dead 'connected' state.
          if (roomRef.current?.state === ConnectionState.Connected) return;
          // connectRoom already dispatched sessionConnected, so re-assert
          // reconnecting or the top-of-loop guard bails and the terminal
          // sessionDisconnected never fires.
          dispatch(sessionReconnecting());
        } catch (error) {
          if (isCallGoneError(error)) break;
        }
        await sleepOrOnline(delay);
        delay = Math.min(delay * 2, REJOIN_MAX_DELAY_MS);
      }
      if (sessionRef.current.status === 'reconnecting') dispatch(sessionDisconnected());
    } finally {
      rejoiningRef.current = false;
    }
  }, [dispatch]);

  const handleDisconnected = useCallback(
    (reason?: DisconnectReason) => {
      const status = sessionRef.current.status;
      if (status === 'idle') return;
      switch (reason) {
        case DisconnectReason.CLIENT_INITIATED:
          return;
        case DisconnectReason.PARTICIPANT_REMOVED:
        case DisconnectReason.ROOM_DELETED:
        case DisconnectReason.DUPLICATE_IDENTITY:
          // Kicked, call ended, or this device joined elsewhere: no rejoin.
          // CALL_ENDED / kick handling over the stream owns the messaging.
          void teardown();
          dispatch(sessionReset());
          return;
        default:
          // A join that never connected (e.g. ICE timeout) surfaces its error
          // to the caller; auto-rejoin is only for established calls.
          if (rejoiningRef.current || !everConnectedRef.current) return;
          void teardown().then(() => attemptRejoin());
      }
    },
    [attemptRejoin, dispatch, teardown],
  );

  const connectRoom = useCallback(
    async (result: CallJoinResult, opts: JoinMediaOptions) => {
      await teardown();

      const prefs = preferencesRef.current;
      screenShareCapRef.current = result.screenShareQualityCap;
      const r = new Room({
        // pixelDensity 'screen' factors in the device pixel ratio so a high-DPI
        // viewer requests the full layer instead of a downscaled one - otherwise
        // a Retina screen-share tile reads as ~720p even at native capture.
        adaptiveStream: { pixelDensity: 'screen' },
        dynacast: true,
        audioCaptureDefaults: { deviceId: prefs.audioInputId ?? undefined },
        videoCaptureDefaults: { deviceId: prefs.videoInputId ?? undefined },
      });

      r.on(RoomEvent.Disconnected, (reason) => {
        if (roomRef.current !== r) return;
        handleDisconnected(reason);
      });
      r.on(RoomEvent.ConnectionStateChanged, (state) => {
        if (roomRef.current !== r) return;
        if (state === ConnectionState.Reconnecting) dispatch(sessionReconnecting());
        if (state === ConnectionState.Connected) dispatch(sessionConnected());
      });
      r.on(RoomEvent.LocalTrackPublished, (pub) => {
        if (roomRef.current !== r) return;
        if (pub.source === Track.Source.ScreenShare) {
          dispatch(localMediaChanged({ screenSharing: true }));
          reportMediaState();
        }
      });
      r.on(RoomEvent.LocalTrackUnpublished, (pub) => {
        if (roomRef.current !== r) return;
        if (pub.source === Track.Source.ScreenShare) {
          // Also fires when the browser's own "Stop sharing" bar is used.
          dispatch(localMediaChanged({ screenSharing: false }));
          reportMediaState();
        }
      });
      r.on(RoomEvent.TrackMuted, (pub, participant) => {
        if (roomRef.current !== r || !participant.isLocal) return;
        if (pub.source === Track.Source.Microphone) {
          dispatch(localMediaChanged({ micEnabled: false }));
        } else if (pub.source === Track.Source.Camera) {
          dispatch(localMediaChanged({ cameraEnabled: false }));
        }
        // Catches a host force-mute, which never goes through our toggles.
        reportMediaState();
      });
      r.on(RoomEvent.TrackUnmuted, (pub, participant) => {
        if (roomRef.current !== r || !participant.isLocal) return;
        if (pub.source === Track.Source.Microphone) {
          dispatch(localMediaChanged({ micEnabled: true }));
        } else if (pub.source === Track.Source.Camera) {
          dispatch(localMediaChanged({ cameraEnabled: true }));
        }
        reportMediaState();
      });

      const url = resolveSignalingUrl(result.wsUrl);
      const rtcConfig = buildRtcConfiguration(result.iceServers, result.iceTransportPolicy);
      tokenRef.current = result.livekitToken;
      roomRef.current = r;
      everConnectedRef.current = false;

      try {
        await r.connect(url, result.livekitToken, { rtcConfig });
      } catch (error) {
        roomRef.current = null;
        tokenRef.current = null;
        throw error;
      }

      everConnectedRef.current = true;
      connectedAtRef.current = Date.now();
      setRoom(r);
      dispatch(sessionConnected());
      scheduleTokenRefresh(result.livekitToken, result.call.id);
      await publishInitialMedia(r, opts);

      if (prefs.audioOutputId) {
        try {
          await r.switchActiveDevice('audiooutput', prefs.audioOutputId);
        } catch {
          // Speaker selection is unsupported on some browsers (Firefox/Safari).
        }
      }
    },
    [dispatch, handleDisconnected, publishInitialMedia, reportMediaState, scheduleTokenRefresh, teardown],
  );
  connectRoomRef.current = connectRoom;

  const guardOtherTab = useCallback(async (): Promise<boolean> => {
    const otherTabActive = await probeOtherTab();
    if (otherTabActive) {
      toast.error('Already in a call in another tab', {
        action: { label: 'Go to call', onClick: () => requestFocus() },
      });
      return false;
    }
    return true;
  }, [probeOtherTab, requestFocus]);

  const joinChannelCall = useCallback(
    async (channelId: string, opts: JoinMediaOptions) => {
      if (!(await guardOtherTab())) return;
      const result = await dispatch(initiateCall(channelId)).unwrap();
      dispatch(
        sessionConnecting({
          callId: result.call.id,
          channelId,
          screenShareQualityCap: result.screenShareQualityCap,
        }),
      );
      try {
        await connectRoom(result, opts);
      } catch (error) {
        dispatch(sessionReset());
        // Roll back the participant row so the roster does not show a ghost
        // until the connection-aborted webhook or reconciler catches up.
        void dispatch(leaveCall(result.call.id));
        throw error;
      }
    },
    [connectRoom, dispatch, guardOtherTab],
  );

  const joinCallById = useCallback(
    async (callId: string, channelId: string, opts: JoinMediaOptions) => {
      if (!(await guardOtherTab())) return;
      const result = await dispatch(joinCall(callId)).unwrap();
      dispatch(
        sessionConnecting({
          callId,
          channelId,
          screenShareQualityCap: result.screenShareQualityCap,
        }),
      );
      try {
        await connectRoom(result, opts);
      } catch (error) {
        dispatch(sessionReset());
        void dispatch(leaveCall(callId));
        throw error;
      }
    },
    [connectRoom, dispatch, guardOtherTab],
  );

  const leaveCurrentCall = useCallback(async () => {
    const { callId } = sessionRef.current;
    clearCallMarkers();
    dispatch(sessionReset());
    await teardown();
    if (callId) {
      try {
        await dispatch(leaveCall(callId)).unwrap();
      } catch {
        // The participant_left webhook cleans up if the RPC failed.
      }
    }
  }, [dispatch, teardown]);

  const endCurrentCall = useCallback(async () => {
    const { callId, channelId } = sessionRef.current;
    clearCallMarkers();
    dispatch(sessionReset());
    await teardown();
    if (callId && channelId) {
      try {
        await dispatch(endCallThunk({ callId, channelId })).unwrap();
      } catch {
        // Backend reconciler closes the room if this failed.
      }
    }
  }, [dispatch, teardown]);

  const rejoin = useCallback(async () => {
    await attemptRejoin();
  }, [attemptRejoin]);

  const toggleMic = useCallback(async () => {
    const r = roomRef.current;
    if (!r) return;
    const enabled = r.localParticipant.isMicrophoneEnabled;
    await r.localParticipant.setMicrophoneEnabled(!enabled);
    dispatch(localMediaChanged({ micEnabled: !enabled }));
    reportMediaState();
  }, [dispatch, reportMediaState]);

  const toggleCamera = useCallback(async () => {
    const r = roomRef.current;
    if (!r) return;
    const enabled = r.localParticipant.isCameraEnabled;
    await r.localParticipant.setCameraEnabled(!enabled);
    dispatch(localMediaChanged({ cameraEnabled: !enabled }));
    reportMediaState();
  }, [dispatch, reportMediaState]);

  const toggleScreenShare = useCallback(async () => {
    const r = roomRef.current;
    if (!r) return;
    const enabled = r.localParticipant.isScreenShareEnabled;
    const tier = clampQuality(
      preferencesRef.current.screenShareQuality,
      screenShareCapRef.current,
    );
    const cfg = screenShareConfig(tier);
    try {
      await r.localParticipant.setScreenShareEnabled(
        !enabled,
        { audio: true, resolution: cfg.captureResolution, contentHint: 'detail' },
        { screenShareEncoding: cfg.encoding, screenShareSimulcastLayers: cfg.simulcastLayers },
      );
      dispatch(localMediaChanged({ screenSharing: !enabled }));
      reportMediaState();
    } catch {
      // User cancelled the browser share picker.
    }
  }, [dispatch, reportMediaState]);

  const switchDevice = useCallback(async (kind: MediaDeviceKind, deviceId: string) => {
    const r = roomRef.current;
    if (!r) return;
    await r.switchActiveDevice(kind, deviceId);
  }, []);

  // Backend kicked this device (channel removal, tkv bump, host kick): the
  // roster row for this identity disappears from the session call.
  const myIdentity = `${currentUserId}:${getDeviceId()}`;
  const stillInRoster = sessionCall?.participants.some((p) => p.identity === myIdentity) ?? true;
  useEffect(() => {
    if (
      !stillInRoster &&
      sessionRef.current.status === 'connected' &&
      // Identity is user:device and survives refresh, so a stale leave event
      // for the pre-refresh session can arrive right after a rejoin; a fresh
      // connection is trusted over the roster for a short grace.
      Date.now() - connectedAtRef.current > ROSTER_KICK_GRACE_MS
    ) {
      // LiveKit will also fire Disconnected(PARTICIPANT_REMOVED); this is the
      // fast path so the UI reacts even if the SDK event lags.
      void teardown();
      dispatch(sessionReset());
    }
  }, [stillInRoster, teardown, dispatch]);

  // Second device of the same user joining: surface the switch-primary toast.
  const otherDeviceCount =
    sessionCall?.participants.filter(
      (p) => p.userId === currentUserId && p.identity !== myIdentity,
    ).length ?? 0;
  const prevOtherDeviceCountRef = useRef(otherDeviceCount);
  useEffect(() => {
    if (
      otherDeviceCount > prevOtherDeviceCountRef.current &&
      sessionRef.current.status === 'connected'
    ) {
      const other = sessionCall?.participants.find(
        (p) => p.userId === currentUserId && p.identity !== myIdentity,
      );
      toast.info(
        `You joined this call on ${other?.deviceLabel ?? 'another device'}. Mic is muted there.`,
      );
    }
    prevOtherDeviceCountRef.current = otherDeviceCount;
  }, [otherDeviceCount, sessionCall, currentUserId, myIdentity]);

  // Refresh / tab close / navigation away: record continuity markers and
  // leave eagerly so other participants see it immediately. Solo calls skip
  // the leave; leaving as the last participant would end the call, and a
  // refresh should come back to it (LiveKit timeout + reconciler clean up
  // if the tab never returns).
  useEffect(() => {
    const onPageHide = () => {
      const { status, callId, channelId, micEnabled, cameraEnabled } = sessionRef.current;
      const active =
        status === 'connected' || status === 'connecting' || status === 'reconnecting';
      if (!active || !callId || !channelId) return;
      writeCallMarkers({ callId, channelId, micEnabled, cameraEnabled, ts: Date.now() });
      const others = roomRef.current?.remoteParticipants.size ?? 0;
      if (others > 0 && orgIdRef.current) {
        sendLeaveBeacon(orgIdRef.current, callId);
      }
    };
    window.addEventListener('pagehide', onPageHide);
    return () => window.removeEventListener('pagehide', onPageHide);
  }, []);

  // Session continuity: a fresh marker in sessionStorage (refresh or
  // crash-restore) rejoins silently; a localStorage-only marker (full
  // browser restart) offers a rejoin prompt instead.
  useEffect(() => {
    if (!currentOrgId || restoreAttemptedRef.current) return;
    restoreAttemptedRef.current = true;
    const sessionMarker = consumeSessionMarker();
    const target = sessionMarker ?? readRecentMarker();
    if (!target) return;
    void (async () => {
      try {
        const call = await dispatch(fetchActiveCall(target.channelId)).unwrap();
        if (!call || call.id !== target.callId) {
          clearCallMarkers();
          return;
        }
        if (sessionMarker) {
          await joinCallById(target.callId, target.channelId, {
            micEnabled: target.micEnabled,
            cameraEnabled: target.cameraEnabled,
          });
        } else {
          clearCallMarkers();
          toast.info('A call you were in is still going.', {
            duration: 15_000,
            action: {
              label: 'Rejoin',
              onClick: () => {
                void joinCallById(target.callId, target.channelId, {
                  micEnabled: false,
                  cameraEnabled: false,
                });
              },
            },
          });
        }
      } catch {
        // A transient fetchActiveCall failure must not strand the user out of a
        // still-live call. Leave the recent (localStorage) marker in place so a
        // reload can retry within its TTL, and offer a manual rejoin now.
        toast.info('A call you were in may still be going.', {
          duration: 15_000,
          action: {
            label: 'Rejoin',
            onClick: () => {
              void joinCallById(target.callId, target.channelId, {
                micEnabled: false,
                cameraEnabled: false,
              });
            },
          },
        });
      }
    })();
  }, [currentOrgId, dispatch, joinCallById]);

  // Sign-out clears the auth identity but leaves this provider mounted (it
  // wraps every route, /auth included), so its unmount teardown never fires.
  // Disconnect the Room and wipe the store on any identity-clearing path (menu
  // logout, a 401 that forces logout) - otherwise the mic keeps transmitting on
  // the login screen and the "live in call" chrome renders while logged out.
  // The SFU emits participant_left on disconnect, so the server roster converges.
  const wasAuthedRef = useRef(Boolean(currentUserId));
  useEffect(() => {
    const isAuthed = Boolean(currentUserId);
    if (wasAuthedRef.current && !isAuthed) {
      void teardown();
      dispatch(clearCalls());
    }
    wasAuthedRef.current = isAuthed;
  }, [currentUserId, teardown, dispatch]);

  // endedInfo is set when the call ended or vanished from a resync. A genuine
  // end also fires SDK Disconnected, which tears the room down, but a resync
  // -driven end (stale snapshot / org switch) does not - so disconnect here too,
  // otherwise the room keeps transmitting behind the "Call ended" modal. Keyed on
  // the reactive `room` (not roomRef) so a rejoin that reconnects a room AFTER
  // endedInfo was set is still torn down; a fresh join is safe because
  // sessionConnecting clears endedInfo before `room` becomes non-null.
  useEffect(() => {
    if (endedInfo && room) {
      void teardown();
    }
  }, [endedInfo, room, teardown]);

  // Switching org context mid-call (/select-org lives inside this provider) must
  // leave the call in the previous org: the room stays connected otherwise, and
  // the new org's ListActiveCalls resync would flag the now-absent call as ended
  // while the mic keeps transmitting. currentUserId-clear (logout) is handled above.
  const prevOrgRef = useRef(currentOrgId);
  useEffect(() => {
    if (prevOrgRef.current && currentOrgId && prevOrgRef.current !== currentOrgId) {
      void teardown();
      clearCallMarkers();
      dispatch(clearCalls());
    }
    prevOrgRef.current = currentOrgId;
  }, [currentOrgId, teardown, dispatch]);

  // App unmount tears the room down; the SFU's participant_left webhook and the
  // reconciler converge the server-side roster.
  useEffect(() => {
    return () => {
      void teardown();
    };
  }, [teardown]);

  const value = useMemo<CallContextValue>(
    () => ({
      room,
      joinChannelCall,
      joinCallById,
      leaveCurrentCall,
      endCurrentCall,
      rejoin,
      toggleMic,
      toggleCamera,
      toggleScreenShare,
      switchDevice,
      focusCallTab: requestFocus,
    }),
    [
      room,
      joinChannelCall,
      joinCallById,
      leaveCurrentCall,
      endCurrentCall,
      rejoin,
      toggleMic,
      toggleCamera,
      toggleScreenShare,
      switchDevice,
      requestFocus,
    ],
  );

  return <CallContext.Provider value={value}>{children}</CallContext.Provider>;
}
