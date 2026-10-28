import { useState } from "react";
import { Link } from "react-router-dom";
import { Phone } from "@phosphor-icons/react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PaneHeader, PaneHeaderBar } from "@/components/ui/pane-header";
import { Select } from "@/components/ui/select";
import { ToggleSwitch } from "@/components/ui/toggle-switch";
import { useDevices } from "@/features/calls/hooks/useDevices";
import { callErrorMessage } from "@/features/calls/utils/callErrors";
import {
  audioInputSelected,
  audioOutputSelected,
  videoInputSelected,
  cameraOnChanged,
  joinMutedChanged,
  ringtoneToggled,
  selectCallPreferences,
} from "@/features/calls/store/callPreferencesSlice";

export function CallsSection() {
  const dispatch = useAppDispatch();
  const preferences = useAppSelector(selectCallPreferences);
  const { audioInputs, videoInputs, audioOutputs, refresh } = useDevices();
  const [error, setError] = useState<string | null>(null);
  const [requesting, setRequesting] = useState(false);
  const speakerSupported =
    typeof HTMLMediaElement !== "undefined" && "setSinkId" in HTMLMediaElement.prototype;
  const revealDevices = async () => {
    setRequesting(true);
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: audioInputs.length > 0 || videoInputs.length === 0,
        video: videoInputs.length > 0,
      });
      stream.getTracks().forEach((track) => track.stop());
      await refresh();
    } catch (failure) {
      setError(callErrorMessage(failure));
    } finally {
      setRequesting(false);
    }
  };
  const toggles = [
    {
      label: "Incoming ringtone",
      description: "Play a sound when someone calls you.",
      checked: preferences.ringtoneEnabled,
      change: ringtoneToggled,
    },
    {
      label: "Join muted",
      description: "Start with microphone off. You can change this before joining.",
      checked: preferences.joinMuted ?? true,
      change: joinMutedChanged,
    },
    {
      label: "Start with camera on",
      description: "Show camera preview before joining and start with video enabled.",
      checked: preferences.cameraOn ?? false,
      change: cameraOnChanged,
    },
  ];
  const devices = [
    {
      label: "Microphone",
      items: audioInputs,
      value: preferences.audioInputId,
      change: audioInputSelected,
    },
    {
      label: "Camera",
      items: videoInputs,
      value: preferences.videoInputId,
      change: videoInputSelected,
    },
    {
      label: "Speaker",
      items: audioOutputs,
      value: preferences.audioOutputId,
      change: audioOutputSelected,
    },
  ];
  return (
    <div className="max-w-3xl space-y-6" data-testid="call-settings">
      <PaneHeader>
        <PaneHeaderBar icon={Phone} title="Calls" subtitle="Defaults for calls on this device" />
      </PaneHeader>
      <Card tone="surface" className="divide-y divide-border/60 px-4 sm:px-6">
        {toggles.map(({ label, description, checked, change }) => (
          <div key={label} className="flex min-h-20 items-center justify-between gap-6 py-4">
            <div>
              <p className="text-sm font-medium">{label}</p>
              <p className="mt-1 text-sm text-muted-foreground">{description}</p>
            </div>
            <ToggleSwitch
              enabled={checked}
              onChange={(value) => dispatch(change(value))}
              ariaLabel={label}
            />
          </div>
        ))}
      </Card>
      <Card tone="surface" className="space-y-5 p-4 sm:p-6">
        <div>
          <h2 className="text-base font-medium">Default devices</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Used for your next call. Unavailable devices fall back to system defaults.
          </p>
        </div>
        {devices.map(({ label, items, value, change }) => {
          const known = items.some((device) => device.deviceId === value);
          const unavailable = label === "Speaker" && !speakerSupported;
          return (
            <div key={label} className="grid items-center gap-2 sm:grid-cols-[8rem_1fr]">
              <span className="text-sm text-muted-foreground">{label}</span>
              <Select
                ariaLabel={`Default ${label.toLowerCase()}`}
                value={known ? value! : ""}
                disabled={unavailable}
                onChange={(id) => dispatch(change(id || null))}
                options={[
                  { value: "", label: unavailable ? "Managed by browser" : "System default" },
                  ...items
                    .filter((device) => device.deviceId)
                    .map((device, index) => ({
                      value: device.deviceId,
                      label: device.label || `${label} ${index + 1}`,
                    })),
                ]}
                triggerClassName="w-full min-h-11"
              />
            </div>
          );
        })}
        <div className="space-y-2">
          <Button variant="outline" onClick={() => void revealDevices()} loading={requesting}>
            Allow device access
          </Button>
          <p className="text-xs text-muted-foreground">
            Browser permission reveals device names. Preview capture stops immediately.
          </p>
        </div>
        {error && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
      </Card>
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
        <p>
          Type <kbd className="text-foreground">/call</kbd> in a channel to open call setup.
        </p>
        <Link
          to="/settings?section=shortcuts"
          className="text-primary underline underline-offset-4"
        >
          Customize call shortcuts
        </Link>
      </div>
    </div>
  );
}
