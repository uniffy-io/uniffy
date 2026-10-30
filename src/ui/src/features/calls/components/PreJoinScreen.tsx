import { fetchTownHallAllowed } from "@/features/calls/store/callsThunks";
import { canPublishInCall, AUDIENCE_MESSAGE } from "@/features/calls/utils/callPublishing";
import { CallAvailability } from "@uniffy/proto/calls/v1/calls_pb";
import { callAvailabilityMessage, callErrorMessage } from "@/features/calls/utils/callErrors";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Microphone,
  MicrophoneSlash,
  VideoCamera,
  VideoCameraSlash,
  Presentation,
  UsersThree,
  Warning,
} from "@phosphor-icons/react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@/components/ui/modal";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { OptionTile } from "@/components/ui/option-tile";
import { popoverShellClass } from "@/components/ui/popover";
import { Select } from "@/components/ui/select";
import { cn } from "@/shared/utils/cn";
import { SubjectAvatarById } from "@/components/subject";
import { callControlClass, callControlOffClass } from "@/features/calls/components/controlChrome";
import {
  deviceOptions,
  selectedDevice,
  speakerSelectionSupported,
} from "@/features/calls/utils/deviceOptions";
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

function DeviceField({
  label,
  devices,
  value,
  onChange,
  managedByBrowser = false,
}: {
  label: string;
  devices: MediaDeviceInfo[];
  value: string | null;
  onChange: (id: string | null) => void;
  managedByBrowser?: boolean;
}) {
  return (
    <div className="grid items-center gap-1 sm:grid-cols-[6rem_1fr] sm:gap-3">
      <span className="text-sm text-muted-foreground">{label}</span>
      <Select
        ariaLabel={label}
        value={selectedDevice(devices, value)}
        disabled={managedByBrowser}
        onChange={(id) => onChange(id || null)}
        options={deviceOptions(label, devices, managedByBrowser)}
        className="min-w-0"
        triggerClassName="w-full min-w-0"
      />
    </div>
  );
}

function PreJoinContent() {
  const dispatch = useAppDispatch();
  const { joinChannelCall, joinCallById, availability, checkAvailability } = useCall();
  const prejoin = useAppSelector(selectPrejoin);
  const channelId = prejoin?.channelId ?? null;
  const callId = prejoin?.callId ?? null;
  const calendarEventId = prejoin?.calendarEventId;
  const channel = useAppSelector((s) => (channelId ? s.chatChannels.byId[channelId] : undefined));
  const activeCall = useAppSelector((s) =>
    channelId ? selectActiveCallForChannel(s, channelId) : null,
  );
  const preferences = useAppSelector(selectCallPreferences);
  const userId = useAppSelector((s) => s.auth.user?.id ?? "");
  const audience = !canPublishInCall(activeCall, userId);
  const [townHall, setTownHall] = useState(false);
  const [callTitle, setCallTitle] = useState("");
  const [allowedChannel, setAllowedChannel] = useState<string | null>(null);
  useEffect(() => {
    if (!channelId || activeCall || callId) return;
    let cancelled = false;
    void dispatch(fetchTownHallAllowed(channelId))
      .unwrap()
      .then((allowed) => {
        if (!cancelled) setAllowedChannel(allowed ? channelId : null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [channelId, activeCall, callId, dispatch]);
  const userName = useAppSelector((s) => s.auth.user?.fullName ?? "");
  const { audioInputs, videoInputs, audioOutputs, refresh } = useDevices();

  const [micOn, setMicOn] = useState(!(preferences.joinMuted ?? true));
  const [camOn, setCamOn] = useState(preferences.cameraOn ?? false);
  const [micError, setMicError] = useState<string | null>(null);
  const [camError, setCamError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [checkedTarget, setCheckedTarget] = useState<string | null>(null);
  useEffect(() => {
    if (!channelId) return;
    let cancelled = false;
    void checkAvailability(true).then(() => {
      if (!cancelled) setCheckedTarget(channelId);
    });
    return () => {
      cancelled = true;
    };
  }, [channelId, checkAvailability]);
  const ready = checkedTarget === channelId && availability === CallAvailability.READY;

  const videoRef = useRef<HTMLVideoElement>(null);
  const camStreamRef = useRef<MediaStream | null>(null);
  const [micStream, setMicStream] = useState<MediaStream | null>(null);

  const stopCamStream = useCallback(() => {
    camStreamRef.current?.getTracks().forEach((t) => t.stop());
    camStreamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const micStreamRef = useRef<MediaStream | null>(null);
  const stopMicStream = useCallback(() => {
    micStreamRef.current?.getTracks().forEach((track) => track.stop());
    micStreamRef.current = null;
    setMicStream(null);
  }, []);

  useEffect(() => {
    if (!camOn || audience) {
      stopCamStream();
      return;
    }
    let cancelled = false;
    Promise.resolve()
      .then(() =>
        navigator.mediaDevices.getUserMedia({
          video: { deviceId: preferences.videoInputId ?? undefined },
        }),
      )
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        setCamError(null);
        camStreamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
        void refresh();
      })
      .catch((error) => {
        if (!cancelled) {
          setCamError(callErrorMessage(error, "camera"));
          setCamOn(false);
        }
      });
    return () => {
      cancelled = true;
      stopCamStream();
    };
  }, [camOn, audience, preferences.videoInputId, refresh, stopCamStream]);

  useEffect(() => {
    if (!micOn || audience) {
      // Stops the live capture tracks; the state clear is the bookkeeping half.
      // eslint-disable-next-line react/react-compiler -- releasing the mic must happen the moment micOn flips
      stopMicStream();
      return;
    }
    let cancelled = false;
    Promise.resolve()
      .then(() =>
        navigator.mediaDevices.getUserMedia({
          audio: { deviceId: preferences.audioInputId ?? undefined },
        }),
      )
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        micStreamRef.current = stream;
        setMicStream(stream);
        setMicError(null);
        void refresh();
      })
      .catch((error) => {
        if (!cancelled) {
          setMicError(callErrorMessage(error, "microphone"));
          setMicOn(false);
        }
      });
    return () => {
      cancelled = true;
      stopMicStream();
    };
  }, [micOn, audience, preferences.audioInputId, refresh, stopMicStream]);

  const close = useCallback(() => {
    // Reset the toggles so the acquire effects re-run their cleanup (flip
    // `cancelled`): a getUserMedia that resolves after Cancel then stops its
    // tracks instead of leaving the camera/mic capturing with no UI. Also clears
    // the "ON but black preview" state on reopen.
    setMicOn(false);
    setCamOn(false);
    setMicError(null);
    setCamError(null);
    setJoinError(null);
    setCheckedTarget(null);
    stopCamStream();
    stopMicStream();
    dispatch(prejoinClosed());
  }, [dispatch, stopCamStream, stopMicStream]);

  const handleJoin = useCallback(async () => {
    if (!channelId || !ready) return;
    setJoining(true);
    setJoinError(null);
    const opts = { micEnabled: micOn && !audience, cameraEnabled: camOn && !audience, townHall };
    stopCamStream();
    stopMicStream();
    try {
      // A prejoin opened for a ring targets that exact call; only a
      // channel-initiated prejoin may start a new call.
      if (callId) {
        await joinCallById(callId, channelId, opts);
      } else {
        await joinChannelCall(channelId, opts, {
          calendarEventId,
          title: callTitle.trim() || undefined,
        });
      }
      setMicOn(false);
      setCamOn(false);
      setCheckedTarget(null);
      dispatch(prejoinClosed());
    } catch (error) {
      // The preview streams were released before the attempt; clear the toggles
      // so they do not read "on" with no preview while the user retries.
      setMicOn(false);
      setCamOn(false);
      setJoinError(callErrorMessage(error));
    } finally {
      setJoining(false);
    }
  }, [
    channelId,
    ready,
    callId,
    calendarEventId,
    callTitle,
    micOn,
    camOn,
    audience,
    townHall,
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
          {!activeCall && !callId && (
            <div>
              <label htmlFor="call-title" className="mb-1 block text-sm text-muted-foreground">
                Call name (optional)
              </label>
              <Input
                id="call-title"
                value={callTitle}
                onChange={(event) => setCallTitle(event.target.value)}
                placeholder={calendarEventId ? "Use event title" : "e.g. P0 checkout debugging"}
                maxLength={500}
                disabled={joining}
                aria-describedby="call-title-hint"
              />
              <p id="call-title-hint" className="mt-1 text-xs text-muted-foreground">
                Shown in call history.
              </p>
            </div>
          )}
          {!activeCall && !callId && allowedChannel === channelId && (
            <div>
              <p id="call-mode-label" className="mb-1 text-sm text-muted-foreground">
                Mode
              </p>
              <div
                role="radiogroup"
                aria-labelledby="call-mode-label"
                className="grid gap-2 sm:grid-cols-2"
              >
                <OptionTile
                  selected={!townHall}
                  icon={<UsersThree size={16} />}
                  label="Regular call"
                  description="Everyone can use their microphone, camera and screen."
                  onSelect={() => setTownHall(false)}
                  disabled={joining}
                />
                <OptionTile
                  selected={townHall}
                  icon={<Presentation size={16} />}
                  label="Town hall"
                  description="You present. Others listen and raise a hand to speak."
                  onSelect={() => setTownHall(true)}
                  disabled={joining}
                />
              </div>
            </div>
          )}
          {audience && (
            <p role="status" className="text-sm text-muted-foreground">
              {AUDIENCE_MESSAGE}
            </p>
          )}

          <div className="relative flex aspect-video items-center justify-center overflow-hidden rounded-lg bg-card shadow-edge">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className={cn("h-full w-full object-cover scale-x-[-1]", !camOn && "hidden")}
            />
            {!camOn && (
              <SubjectAvatarById
                userId={userId}
                displayName={userName}
                size="lg"
                className="h-16 w-16 text-xl"
                maxScale={1.6}
              />
            )}
            <div
              className={cn(
                popoverShellClass,
                "absolute bottom-2 left-1/2 flex -translate-x-1/2 items-center gap-1 p-1",
              )}
            >
              <button
                type="button"
                disabled={audience}
                onClick={() => setMicOn((v) => !v)}
                className={cn(callControlClass(), !(micOn && !audience) && callControlOffClass)}
                aria-label={micOn ? "Turn microphone off" : "Turn microphone on"}
                aria-pressed={micOn && !audience}
                title={micOn ? "Turn microphone off" : "Turn microphone on"}
                data-testid="call-prejoin-mic-toggle"
              >
                {micOn && !audience ? <Microphone size={16} /> : <MicrophoneSlash size={16} />}
              </button>
              <button
                type="button"
                disabled={audience}
                onClick={() => setCamOn((v) => !v)}
                className={cn(callControlClass(), !(camOn && !audience) && callControlOffClass)}
                aria-label={camOn ? "Turn camera off" : "Turn camera on"}
                aria-pressed={camOn && !audience}
                title={camOn ? "Turn camera off" : "Turn camera on"}
                data-testid="call-prejoin-camera-toggle"
              >
                {camOn && !audience ? <VideoCamera size={16} /> : <VideoCameraSlash size={16} />}
              </button>
            </div>
          </div>

          {micOn && <MicLevelMeter stream={micStream} />}

          {[micError, camError].filter(Boolean).map((error) => (
            <div
              key={error}
              role="alert"
              className="flex items-start gap-2 rounded-md bg-yellow-100 dark:bg-yellow-900/30 px-3 py-2 text-xs text-yellow-800 dark:text-yellow-400"
            >
              <Warning size={14} className="mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          ))}

          <div className="space-y-2">
            <DeviceField
              label="Microphone"
              devices={audioInputs}
              value={preferences.audioInputId}
              onChange={(id) => dispatch(audioInputSelected(id))}
            />
            <DeviceField
              label="Camera"
              devices={videoInputs}
              value={preferences.videoInputId}
              onChange={(id) => dispatch(videoInputSelected(id))}
            />
            <DeviceField
              label="Speaker"
              devices={audioOutputs}
              value={preferences.audioOutputId}
              onChange={(id) => dispatch(audioOutputSelected(id))}
              managedByBrowser={!speakerSelectionSupported}
            />
          </div>

          {alreadyIn.length > 0 && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <div className="flex -space-x-1.5">
                {[...new Map(alreadyIn.map((p) => [p.userId, p])).values()].slice(0, 5).map((p) => (
                  <SubjectAvatarById
                    key={p.userId}
                    userId={p.userId}
                    displayName={p.displayName}
                    avatarUrl={p.avatarUrl ?? undefined}
                    size="sm"
                    bordered
                  />
                ))}
              </div>
              <span>
                {alreadyIn.length} {alreadyIn.length === 1 ? "person is" : "people are"} in the call
              </span>
            </div>
          )}

          {!ready && (
            <div role="status" className="space-y-2 text-sm text-muted-foreground">
              <p>
                {checkedTarget !== channelId
                  ? "Checking call availability..."
                  : callAvailabilityMessage(availability)}
              </p>
              {checkedTarget === channelId && (
                <Button
                  variant="ghost"
                  onClick={() => {
                    setCheckedTarget(null);
                    void checkAvailability(true).then(() => setCheckedTarget(channelId));
                  }}
                >
                  Check again
                </Button>
              )}
            </div>
          )}
          {joinError && (
            <p role="alert" className="text-sm text-destructive">
              {joinError}
            </p>
          )}
        </ModalBody>

        <ModalFooter>
          {joinError === "This call has already ended." ? (
            <Button onClick={close}>Close</Button>
          ) : (
            <>
              <Button variant="ghost" onClick={close} disabled={joining}>
                Cancel
              </Button>
              <Button
                onClick={() => void handleJoin()}
                loading={joining}
                disabled={!ready}
                data-testid="call-prejoin-join"
              >
                {joinError ? "Retry" : "Join"}
              </Button>
            </>
          )}
        </ModalFooter>
      </div>
    </Modal>
  );
}

export function PreJoinScreen() {
  const target = useAppSelector(selectPrejoin);
  if (!target) return null;
  return <PreJoinContent key={`${target.channelId}:${target.callId ?? "new"}`} />;
}
