import { useRef, useState } from "react";
import {
  CaretDown,
  Microphone,
  MicrophoneSlash,
  Monitor,
  PhoneDisconnect,
  Users,
  VideoCamera,
  VideoCameraSlash,
} from "@phosphor-icons/react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { cn } from "@/shared/utils/cn";
import { useCall } from "@/features/calls/components/callContext";
import { DevicePickerMenu } from "@/features/calls/components/DevicePickerMenu";
import { ScreenShareQualityMenu } from "@/features/calls/components/ScreenShareQualityMenu";
import { useDevices } from "@/features/calls/hooks/useDevices";
import { selectCallSession, selectSessionCall } from "@/features/calls/store/callsSlice";
import {
  audioInputSelected,
  screenShareQualitySelected,
  selectCallPreferences,
  videoInputSelected,
} from "@/features/calls/store/callPreferencesSlice";

const controlBase = cn(
  "flex items-center justify-center rounded-lg border border-border/60 bg-muted/40",
  "text-foreground transition-colors hover:bg-muted",
);

const controlClass = cn(controlBase, "h-9 px-2.5");

// Header pill: icon-only squares sized to match the nav icon buttons (w-7 h-7).
const compactControlClass = cn(controlBase, "h-7 w-7 rounded-md");

const offClass = "bg-red-500/15 border-red-500/40 text-red-500 hover:bg-red-500/25";

interface ControlsBarProps {
  compact?: boolean;
  onToggleParticipants?: () => void;
}

export function ControlsBar({ compact = false, onToggleParticipants }: ControlsBarProps) {
  const dispatch = useAppDispatch();
  const {
    toggleMic,
    toggleCamera,
    toggleScreenShare,
    leaveCurrentCall,
    endCurrentCall,
    switchDevice,
  } = useCall();
  const session = useAppSelector(selectCallSession);
  const sessionCall = useAppSelector(selectSessionCall);
  const preferences = useAppSelector(selectCallPreferences);
  const currentUserId = useAppSelector((s) => s.auth.user?.id ?? "");
  const { audioInputs, videoInputs } = useDevices();

  const micMenuRef = useRef<HTMLButtonElement>(null);
  const camMenuRef = useRef<HTMLButtonElement>(null);
  const qualityMenuRef = useRef<HTMLButtonElement>(null);
  const [openMenu, setOpenMenu] = useState<"mic" | "cam" | "quality" | null>(null);

  const isHost = sessionCall?.hostUserId === currentUserId;
  const participantCount = sessionCall?.participants.length ?? 0;

  if (compact) {
    return (
      <div className="flex items-center gap-1" data-testid="call-controls-bar">
        <button
          type="button"
          onClick={() => void toggleMic()}
          className={cn(compactControlClass, !session.micEnabled && offClass)}
          aria-label={session.micEnabled ? "Mute microphone" : "Unmute microphone"}
          data-testid="call-mic-toggle"
        >
          {session.micEnabled ? <Microphone size={15} /> : <MicrophoneSlash size={15} />}
        </button>
        <button
          type="button"
          onClick={() => void toggleCamera()}
          className={cn(compactControlClass, !session.cameraEnabled && offClass)}
          aria-label={session.cameraEnabled ? "Turn camera off" : "Turn camera on"}
          data-testid="call-camera-toggle"
        >
          {session.cameraEnabled ? <VideoCamera size={15} /> : <VideoCameraSlash size={15} />}
        </button>
        <button
          type="button"
          onClick={() => void toggleScreenShare()}
          className={cn(
            compactControlClass,
            session.screenSharing && "border-primary/50 bg-primary/10 text-primary",
          )}
          aria-label={session.screenSharing ? "Stop sharing screen" : "Share screen"}
          data-testid="call-screenshare-toggle"
        >
          <Monitor size={15} />
        </button>
        <button
          type="button"
          onClick={() => void leaveCurrentCall()}
          className={cn(
            compactControlClass,
            "border-red-500 bg-red-500 text-white hover:bg-red-600",
          )}
          aria-label="Leave call"
          data-testid="call-leave-button"
        >
          <PhoneDisconnect size={15} weight="fill" />
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5" data-testid="call-controls-bar">
      <div className="flex items-stretch">
        <button
          type="button"
          onClick={() => void toggleMic()}
          className={cn(controlClass, "rounded-r-none", !session.micEnabled && offClass)}
          aria-label={session.micEnabled ? "Mute microphone" : "Unmute microphone"}
          data-testid="call-mic-toggle"
        >
          {session.micEnabled ? <Microphone size={16} /> : <MicrophoneSlash size={16} />}
        </button>
        <button
          ref={micMenuRef}
          type="button"
          onClick={() => setOpenMenu(openMenu === "mic" ? null : "mic")}
          className={cn(controlClass, "rounded-l-none border-l-0 px-1")}
          aria-label="Select microphone"
        >
          <CaretDown size={10} />
        </button>
      </div>
      <DevicePickerMenu
        open={openMenu === "mic"}
        onClose={() => setOpenMenu(null)}
        triggerRef={micMenuRef}
        devices={audioInputs}
        selectedId={preferences.audioInputId}
        label="Microphone"
        onSelect={(deviceId) => {
          dispatch(audioInputSelected(deviceId));
          void switchDevice("audioinput", deviceId);
        }}
      />

      <div className="flex items-stretch">
        <button
          type="button"
          onClick={() => void toggleCamera()}
          className={cn(controlClass, "rounded-r-none", !session.cameraEnabled && offClass)}
          aria-label={session.cameraEnabled ? "Turn camera off" : "Turn camera on"}
          data-testid="call-camera-toggle"
        >
          {session.cameraEnabled ? <VideoCamera size={16} /> : <VideoCameraSlash size={16} />}
        </button>
        <button
          ref={camMenuRef}
          type="button"
          onClick={() => setOpenMenu(openMenu === "cam" ? null : "cam")}
          className={cn(controlClass, "rounded-l-none border-l-0 px-1")}
          aria-label="Select camera"
        >
          <CaretDown size={10} />
        </button>
      </div>
      <DevicePickerMenu
        open={openMenu === "cam"}
        onClose={() => setOpenMenu(null)}
        triggerRef={camMenuRef}
        devices={videoInputs}
        selectedId={preferences.videoInputId}
        label="Camera"
        onSelect={(deviceId) => {
          dispatch(videoInputSelected(deviceId));
          void switchDevice("videoinput", deviceId);
        }}
      />

      <div className="flex items-stretch">
        <button
          type="button"
          onClick={() => void toggleScreenShare()}
          className={cn(
            controlClass,
            "rounded-r-none",
            session.screenSharing && "border-primary/50 bg-primary/10 text-primary",
          )}
          aria-label={session.screenSharing ? "Stop sharing screen" : "Share screen"}
          data-testid="call-screenshare-toggle"
        >
          <Monitor size={16} />
        </button>
        <button
          ref={qualityMenuRef}
          type="button"
          onClick={() => setOpenMenu(openMenu === "quality" ? null : "quality")}
          className={cn(controlClass, "rounded-l-none border-l-0 px-1")}
          aria-label="Screen share quality"
        >
          <CaretDown size={10} />
        </button>
      </div>
      <ScreenShareQualityMenu
        open={openMenu === "quality"}
        onClose={() => setOpenMenu(null)}
        triggerRef={qualityMenuRef}
        cap={session.screenShareQualityCap}
        selected={preferences.screenShareQuality}
        onSelect={(quality) => dispatch(screenShareQualitySelected(quality))}
      />

      {!compact && onToggleParticipants && (
        <button
          type="button"
          onClick={onToggleParticipants}
          className={cn(controlClass, "gap-1.5 text-xs font-medium tabular-nums")}
          aria-label="Participants"
          data-testid="call-participants-button"
        >
          <Users size={16} />
          {participantCount}
        </button>
      )}

      <button
        type="button"
        onClick={() => void leaveCurrentCall()}
        className={cn(controlClass, "bg-red-500 border-red-500 text-white hover:bg-red-600 px-3")}
        aria-label="Leave call"
        data-testid="call-leave-button"
      >
        <PhoneDisconnect size={16} weight="fill" />
      </button>

      {!compact && isHost && (
        <button
          type="button"
          onClick={() => void endCurrentCall()}
          className="text-xs text-muted-foreground hover:text-red-500 px-1.5"
          data-testid="call-end-for-all-button"
        >
          End for all
        </button>
      )}
    </div>
  );
}
