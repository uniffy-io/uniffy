import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Microphone,
  MicrophoneSlash,
  VideoCamera,
  VideoCameraSlash,
  Warning,
} from '@phosphor-icons/react';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { cn } from '@/shared/utils/cn';
import { getInitials } from '@/components/subject/utils';
import { useCall } from '@/features/calls/components/callContext';
import { useDevices } from '@/features/calls/hooks/useDevices';
import {
  prejoinClosed,
  selectActiveCallForChannel,
  selectPrejoinChannelId,
} from '@/features/calls/store/callsSlice';
import {
  audioInputSelected,
  audioOutputSelected,
  selectCallPreferences,
  videoInputSelected,
} from '@/features/calls/store/callPreferencesSlice';
import { getChannelDisplayName } from '@/features/chat/utils/channelDisplay';

function MicLevelMeter({ stream }: { stream: MediaStream | null }) {
  const [level, setLevel] = useState(0);

  useEffect(() => {
    if (!stream) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset the meter when the mic stream detaches
      setLevel(0);
      return;
    }
    const ctx = new AudioContext();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    const source = ctx.createMediaStreamSource(stream);
    source.connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);
    let raf = 0;
    const tick = () => {
      analyser.getByteFrequencyData(data);
      const avg = data.reduce((a, b) => a + b, 0) / data.length;
      setLevel(Math.min(1, avg / 128));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      source.disconnect();
      void ctx.close();
    };
  }, [stream]);

  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
      <div
        className="h-full rounded-full bg-emerald-500 transition-[width] duration-75"
        style={{ width: `${Math.round(level * 100)}%` }}
      />
    </div>
  );
}

function DeviceSelect({
  label,
  devices,
  value,
  onChange,
}: {
  label: string;
  devices: MediaDeviceInfo[];
  value: string | null;
  onChange: (id: string) => void;
}) {
  if (devices.length === 0) return null;
  return (
    <label className="flex flex-col gap-1 text-xs text-muted-foreground">
      {label}
      <select
        value={value ?? devices[0]?.deviceId ?? ''}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 rounded-md border border-border bg-input px-2 text-sm text-foreground"
      >
        {devices.map((d, i) => (
          <option key={d.deviceId || i} value={d.deviceId}>
            {d.label || `${label} ${i + 1}`}
          </option>
        ))}
      </select>
    </label>
  );
}

export function PreJoinScreen() {
  const dispatch = useAppDispatch();
  const { joinChannelCall } = useCall();
  const channelId = useAppSelector(selectPrejoinChannelId);
  const channel = useAppSelector((s) =>
    channelId ? s.chatChannels.channels.find((c) => c.id === channelId) : undefined,
  );
  const activeCall = useAppSelector((s) =>
    channelId ? selectActiveCallForChannel(s, channelId) : null,
  );
  const preferences = useAppSelector(selectCallPreferences);
  const userName = useAppSelector((s) => s.auth.user?.fullName ?? '');
  const { audioInputs, videoInputs, audioOutputs, refresh } = useDevices();

  const [micOn, setMicOn] = useState(false);
  const [camOn, setCamOn] = useState(false);
  const [micDenied, setMicDenied] = useState(false);
  const [camDenied, setCamDenied] = useState(false);
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const camStreamRef = useRef<MediaStream | null>(null);
  const [micStream, setMicStream] = useState<MediaStream | null>(null);

  const stopCamStream = useCallback(() => {
    camStreamRef.current?.getTracks().forEach((t) => t.stop());
    camStreamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const stopMicStream = useCallback(() => {
    setMicStream((s) => {
      s?.getTracks().forEach((t) => t.stop());
      return null;
    });
  }, []);

  useEffect(() => {
    if (!camOn) {
      stopCamStream();
      return;
    }
    let cancelled = false;
    navigator.mediaDevices
      .getUserMedia({
        video: { deviceId: preferences.videoInputId ?? undefined },
      })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        camStreamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
        void refresh();
      })
      .catch(() => {
        if (!cancelled) {
          setCamDenied(true);
          setCamOn(false);
        }
      });
    return () => {
      cancelled = true;
      stopCamStream();
    };
  }, [camOn, preferences.videoInputId, refresh, stopCamStream]);

  useEffect(() => {
    if (!micOn) {
      stopMicStream();
      return;
    }
    let cancelled = false;
    navigator.mediaDevices
      .getUserMedia({
        audio: { deviceId: preferences.audioInputId ?? undefined },
      })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        setMicStream(stream);
        setMicDenied(false);
        void refresh();
      })
      .catch(() => {
        if (!cancelled) {
          setMicDenied(true);
          setMicOn(false);
        }
      });
    return () => {
      cancelled = true;
      stopMicStream();
    };
  }, [micOn, preferences.audioInputId, refresh, stopMicStream]);

  const close = useCallback(() => {
    // Reset the toggles so the acquire effects re-run their cleanup (flip
    // `cancelled`): a getUserMedia that resolves after Cancel then stops its
    // tracks instead of leaving the camera/mic capturing with no UI. Also clears
    // the "ON but black preview" state on reopen.
    setMicOn(false);
    setCamOn(false);
    setMicDenied(false);
    setCamDenied(false);
    stopCamStream();
    stopMicStream();
    dispatch(prejoinClosed());
  }, [dispatch, stopCamStream, stopMicStream]);

  const handleJoin = useCallback(async () => {
    if (!channelId) return;
    setJoining(true);
    setJoinError(false);
    const opts = { micEnabled: micOn, cameraEnabled: camOn };
    stopCamStream();
    stopMicStream();
    try {
      await joinChannelCall(channelId, opts);
      // Reset toggles so a later reopen starts fresh (mic/cam off) rather than
      // showing a stale "ON" with no preview stream.
      setMicOn(false);
      setCamOn(false);
      dispatch(prejoinClosed());
    } catch {
      // The preview streams were released before the attempt; clear the toggles
      // so they do not read "on" with no preview while the user retries.
      setMicOn(false);
      setCamOn(false);
      setJoinError(true);
    } finally {
      setJoining(false);
    }
  }, [channelId, micOn, camOn, joinChannelCall, dispatch, stopCamStream, stopMicStream]);

  if (!channelId) return null;

  const alreadyIn = activeCall?.participants ?? [];
  const channelName = channel ? getChannelDisplayName(channel) : 'this channel';

  return (
    <Modal onClose={close} maxWidth="max-w-md">
      <div className="p-5 space-y-4" data-testid="call-prejoin">
        <div>
          <h2 className="text-base font-semibold text-foreground">
            {activeCall ? `Join call in ${channelName}` : `Start call in ${channelName}`}
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">Joining as {userName}</p>
        </div>

        <div className="relative aspect-video overflow-hidden rounded-lg bg-muted/60 border border-border/60 flex items-center justify-center">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className={cn('h-full w-full object-cover scale-x-[-1]', !camOn && 'hidden')}
          />
          {!camOn && (
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/15 text-primary text-xl font-semibold">
              {getInitials(userName)}
            </div>
          )}
          <div className="absolute bottom-2 left-1/2 flex -translate-x-1/2 items-center gap-2">
            <button
              type="button"
              onClick={() => setMicOn((v) => !v)}
              className={cn(
                'flex h-9 w-9 items-center justify-center rounded-full border',
                micOn
                  ? 'bg-card/90 border-border text-foreground'
                  : 'bg-red-500/90 border-red-500 text-white',
              )}
              aria-label={micOn ? 'Turn microphone off' : 'Turn microphone on'}
              data-testid="call-prejoin-mic-toggle"
            >
              {micOn ? <Microphone size={16} /> : <MicrophoneSlash size={16} />}
            </button>
            <button
              type="button"
              onClick={() => setCamOn((v) => !v)}
              className={cn(
                'flex h-9 w-9 items-center justify-center rounded-full border',
                camOn
                  ? 'bg-card/90 border-border text-foreground'
                  : 'bg-red-500/90 border-red-500 text-white',
              )}
              aria-label={camOn ? 'Turn camera off' : 'Turn camera on'}
              data-testid="call-prejoin-camera-toggle"
            >
              {camOn ? <VideoCamera size={16} /> : <VideoCameraSlash size={16} />}
            </button>
          </div>
        </div>

        {micOn && <MicLevelMeter stream={micStream} />}

        {(micDenied || camDenied) && (
          <div className="flex items-start gap-2 rounded-md bg-yellow-100 dark:bg-yellow-900/30 px-3 py-2 text-xs text-yellow-800 dark:text-yellow-400">
            <Warning size={14} className="mt-0.5 shrink-0" />
            <span>
              {micDenied
                ? 'Microphone access was blocked by the browser. You can join listen-only, or allow access in site settings.'
                : 'Camera access was blocked by the browser. You can join without video.'}
            </span>
          </div>
        )}

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <DeviceSelect
            label="Microphone"
            devices={audioInputs}
            value={preferences.audioInputId}
            onChange={(id) => dispatch(audioInputSelected(id))}
          />
          <DeviceSelect
            label="Camera"
            devices={videoInputs}
            value={preferences.videoInputId}
            onChange={(id) => dispatch(videoInputSelected(id))}
          />
          <DeviceSelect
            label="Speaker"
            devices={audioOutputs}
            value={preferences.audioOutputId}
            onChange={(id) => dispatch(audioOutputSelected(id))}
          />
        </div>

        {alreadyIn.length > 0 && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <div className="flex -space-x-1.5">
              {alreadyIn.slice(0, 5).map((p) => (
                <span
                  key={p.identity}
                  className="flex h-6 w-6 items-center justify-center rounded-full border border-card bg-primary/15 text-[10px] font-semibold text-primary"
                  title={p.displayName}
                >
                  {getInitials(p.displayName)}
                </span>
              ))}
            </div>
            <span>
              {alreadyIn.length} {alreadyIn.length === 1 ? 'person is' : 'people are'} in the call
            </span>
          </div>
        )}

        {joinError && (
          <p className="text-xs text-red-500">Unable to connect. Check your network and retry.</p>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={close} disabled={joining}>
            Cancel
          </Button>
          <Button onClick={() => void handleJoin()} loading={joining} data-testid="call-prejoin-join">
            {joinError ? 'Retry' : 'Join'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
