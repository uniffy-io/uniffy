import { useCallback, useEffect, useRef, useState } from "react";
import {
  Microphone,
  MicrophoneSlash,
  VideoCamera,
  VideoCameraSlash,
  Warning,
} from "@phosphor-icons/react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Select, type SelectOption } from "@/components/ui/select";
import { cn } from "@/shared/utils/cn";
import { getInitials } from "@/components/subject/utils";
import { useCall } from "@/features/calls/components/callContext";
import { useDevices } from "@/features/calls/hooks/useDevices";
import {
  prejoinClosed,
  selectActiveCallForChannel,
  selectPrejoin,
} from "@/features/calls/store/callsSlice";
import {
  audioInputSelected,
  audioOutputSelected,
  selectCallPreferences,
  videoInputSelected,
} from "@/features/calls/store/callPreferencesSlice";
import { getChannelDisplayName } from "@/features/chat/utils/channelDisplay";

function MicLevelMeter({ stream }: { stream: MediaStream | null }) {
  const [level, setLevel] = useState(0);

  useEffect(() => {
    if (!stream) {
      // eslint-disable-next-line react/react-compiler -- reset the meter when the mic stream detaches
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
  const options: SelectOption<string>[] = devices.map((d, i) => ({
    value: d.deviceId,
    label: d.label || `${label} ${i + 1}`,
  }));
  // A stored preference can name a device that is gone, or that the browser
  // hides behind an empty id until its permission is granted. Fall back to the
  // first entry so the trigger never reads "Select...".
  const known = devices.some((d) => d.deviceId === value);
  return (
    <div className="flex min-w-0 flex-col gap-1 text-xs text-muted-foreground">
      {label}
      <Select
        size="sm"
        ariaLabel={label}
        value={known ? (value ?? "") : (devices[0]?.deviceId ?? "")}
        onChange={onChange}
        options={options}
        menuMinWidth={260}
        triggerClassName="h-8 w-full min-w-0 font-normal text-foreground"
      />
    </div>
  );
}

export function PreJoinScreen() {
  const dispatch = useAppDispatch();
  const { joinChannelCall, joinCallById } = useCall();
  const prejoin = useAppSelector(selectPrejoin);
  const channelId = prejoin?.channelId ?? null;
  const callId = prejoin?.callId ?? null;
  const channel = useAppSelector((s) => (channelId ? s.chatChannels.byId[channelId] : undefined));
  const activeCall = useAppSelector((s) =>
    channelId ? selectActiveCallForChannel(s, channelId) : null,
  );
  const preferences = useAppSelector(selectCallPreferences);
  const userName = useAppSelector((s) => s.auth.user?.fullName ?? "");
  const { audioInputs, videoInputs, audioOutputs, refresh } = useDevices();

  const [micOn, setMicOn] = useState(false);
  const [camOn, setCamOn] = useState(false);
  const [micDenied, setMicDenied] = useState(false);
  const [camDenied, setCamDenied] = useState(false);
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<"failed" | "ended" | null>(null);

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
      // Stops the live capture tracks; the state clear is the bookkeeping half.
      // eslint-disable-next-line react/react-compiler -- releasing the mic must happen the moment micOn flips
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
    setJoinError(null);
    stopCamStream();
    stopMicStream();
    dispatch(prejoinClosed());
  }, [dispatch, stopCamStream, stopMicStream]);

  const handleJoin = useCallback(async () => {
    if (!channelId) return;
    setJoining(true);
    setJoinError(null);
    const opts = { micEnabled: micOn, cameraEnabled: camOn };
    stopCamStream();
    stopMicStream();
    try {
      // A prejoin opened for a ring targets that exact call; only a
      // channel-initiated prejoin may start a new call.
      if (callId) {
        await joinCallById(callId, channelId, opts);
      } else {
        await joinChannelCall(channelId, opts);
      }
      // Reset toggles so a later reopen starts fresh (mic/cam off) rather than
      // showing a stale "ON" with no preview stream.
      setMicOn(false);
      setCamOn(false);
      dispatch(prejoinClosed());
    } catch (error) {
      // The preview streams were released before the attempt; clear the toggles
      // so they do not read "on" with no preview while the user retries.
      setMicOn(false);
      setCamOn(false);
      // unwrap() rejects with a SerializedError (plain object), not an Error.
      const message =
        typeof error === "object" && error !== null && "message" in error
          ? String((error as { message?: unknown }).message ?? "")
          : "";
      setJoinError(/call has ended|\[not_found]/i.test(message) ? "ended" : "failed");
    } finally {
      setJoining(false);
    }
  }, [
    channelId,
    callId,
    micOn,
    camOn,
    joinCallById,
    joinChannelCall,
    dispatch,
    stopCamStream,
    stopMicStream,
  ]);

  if (!channelId) return null;

  const alreadyIn = activeCall?.participants ?? [];
  const channelName = channel ? getChannelDisplayName(channel) : "this channel";

  return (
    <Modal onClose={close} closeDisabled={joining} maxWidth="max-w-md">
      <div data-testid="call-prejoin">
        <ModalHeader
          title={
            activeCall || callId ? `Join call in ${channelName}` : `Start call in ${channelName}`
          }
          description={`Joining as ${userName}`}
        />

        <ModalBody className="space-y-4">
          <div className="relative aspect-video overflow-hidden rounded-lg bg-muted/60 border border-border/60 flex items-center justify-center">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className={cn("h-full w-full object-cover scale-x-[-1]", !camOn && "hidden")}
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
                  "flex h-9 w-9 items-center justify-center rounded-full border",
                  micOn
                    ? "bg-card/90 border-border text-foreground"
                    : "bg-red-500/90 border-red-500 text-white",
                )}
                aria-label={micOn ? "Turn microphone off" : "Turn microphone on"}
                data-testid="call-prejoin-mic-toggle"
              >
                {micOn ? <Microphone size={16} /> : <MicrophoneSlash size={16} />}
              </button>
              <button
                type="button"
                onClick={() => setCamOn((v) => !v)}
                className={cn(
                  "flex h-9 w-9 items-center justify-center rounded-full border",
                  camOn
                    ? "bg-card/90 border-border text-foreground"
                    : "bg-red-500/90 border-red-500 text-white",
                )}
                aria-label={camOn ? "Turn camera off" : "Turn camera on"}
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
                  ? "Microphone access was blocked by the browser. You can join listen-only, or allow access in site settings."
                  : "Camera access was blocked by the browser. You can join without video."}
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
                {alreadyIn.length} {alreadyIn.length === 1 ? "person is" : "people are"} in the call
              </span>
            </div>
          )}

          {joinError === "failed" && (
            <p className="text-xs text-red-500">Unable to connect. Check your network and retry.</p>
          )}
          {joinError === "ended" && (
            <p className="text-xs text-muted-foreground" data-testid="call-prejoin-ended">
              This call has already ended.
            </p>
          )}
        </ModalBody>

        <ModalFooter>
          {joinError === "ended" ? (
            <Button onClick={close}>Close</Button>
          ) : (
            <>
              <Button variant="ghost" onClick={close} disabled={joining}>
                Cancel
              </Button>
              <Button
                onClick={() => void handleJoin()}
                loading={joining}
                data-testid="call-prejoin-join"
              >
                {joinError === "failed" ? "Retry" : "Join"}
              </Button>
            </>
          )}
        </ModalFooter>
      </div>
    </Modal>
  );
}
