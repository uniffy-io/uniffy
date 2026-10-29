import {
  Microphone,
  MicrophoneSlash,
  Monitor,
  PhoneDisconnect,
  VideoCamera,
  VideoCameraSlash,
} from "@phosphor-icons/react";
import { useAppSelector } from "@/app/hooks";
import { Button } from "@/components/ui/button";
import { useCall } from "@/features/calls/components/callContext";
import { CallMoreMenu } from "@/features/calls/components/CallMoreMenu";
import { CallParticipation } from "@/features/calls/components/CallParticipation";
import {
  callControlActiveClass,
  callControlClass,
  callControlOffClass,
} from "@/features/calls/components/controlChrome";
import { useCallPublishing } from "@/features/calls/hooks/useCallPublishing";
import { selectCallSession, selectSessionCall } from "@/features/calls/store/callsSlice";
import { useFormattedKeybinding } from "@/features/settings/hooks/useKeyboardShortcuts";
import { cn } from "@/shared/utils/cn";

interface ControlsBarProps {
  compact?: boolean;
  onToggleChat?: () => void;
  chatOpen?: boolean;
  onToggleFullscreen?: () => void;
  isFullscreen?: boolean;
}

export function ControlsBar({ compact = false, ...actions }: ControlsBarProps) {
  const { canPublish } = useCallPublishing();
  const { toggleMic, toggleCamera, toggleScreenShare, leaveCurrentCall } = useCall();
  const session = useAppSelector(selectCallSession);
  const call = useAppSelector(selectSessionCall);
  const muteShortcut = useFormattedKeybinding("calls.mute");
  const cameraShortcut = useFormattedKeybinding("calls.camera");
  const leaveShortcut = useFormattedKeybinding("calls.leave");
  const control = callControlClass(compact);
  return (
    <div
      className={cn("flex items-center justify-center", compact ? "gap-1" : "gap-1.5")}
      data-testid="call-controls-bar"
    >
      <button
        type="button"
        disabled={!canPublish}
        onClick={() => void toggleMic()}
        className={cn(control, !session.micEnabled && callControlOffClass)}
        aria-label={session.micEnabled ? "Mute microphone" : "Unmute microphone"}
        aria-pressed={session.micEnabled}
        title={`${session.micEnabled ? "Mute" : "Unmute"} (${muteShortcut})`}
        data-testid="call-mic-toggle"
      >
        {session.micEnabled ? <Microphone size={16} /> : <MicrophoneSlash size={16} />}
      </button>
      <button
        type="button"
        disabled={!canPublish}
        onClick={() => void toggleCamera()}
        className={cn(control, !session.cameraEnabled && callControlOffClass)}
        aria-label={session.cameraEnabled ? "Turn camera off" : "Turn camera on"}
        aria-pressed={session.cameraEnabled}
        title={`${session.cameraEnabled ? "Turn camera off" : "Turn camera on"} (${cameraShortcut})`}
        data-testid="call-camera-toggle"
      >
        {session.cameraEnabled ? <VideoCamera size={16} /> : <VideoCameraSlash size={16} />}
      </button>
      <button
        type="button"
        disabled={!canPublish}
        onClick={() => void toggleScreenShare()}
        className={cn(control, session.screenSharing && callControlActiveClass)}
        aria-label={session.screenSharing ? "Stop sharing screen" : "Share screen"}
        aria-pressed={session.screenSharing}
        title={session.screenSharing ? "Stop sharing screen" : "Share screen"}
        data-testid="call-screenshare-toggle"
      >
        <Monitor size={16} weight={session.screenSharing ? "fill" : "regular"} />
      </button>
      {!compact && call?.townHall && <CallParticipation variant="hand" />}
      {!compact && <CallMoreMenu {...actions} />}
      <Button
        variant="destructive"
        size={compact ? "icon" : "md"}
        onClick={() => void leaveCurrentCall()}
        className={compact ? "rounded-md" : "ml-1.5 pointer-coarse:min-h-11"}
        aria-label="Leave call"
        title={`Leave call (${leaveShortcut})`}
        data-testid="call-leave-button"
      >
        <PhoneDisconnect size={16} weight="fill" />
        {!compact && <span className="hidden sm:inline">Leave</span>}
      </Button>
    </div>
  );
}
