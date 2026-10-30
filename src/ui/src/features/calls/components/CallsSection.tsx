import { useState } from "react";
import { Link } from "react-router-dom";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { ToggleSwitch } from "@/components/ui/toggle-switch";
import { useDevices } from "@/features/calls/hooks/useDevices";
import { callErrorMessage } from "@/features/calls/utils/callErrors";
import {
  deviceOptions,
  selectedDevice,
  speakerSelectionSupported,
} from "@/features/calls/utils/deviceOptions";
import { cn } from "@/shared/utils/cn";
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
    <div className="space-y-8" data-testid="call-settings">
      <div>
        <h1 className="text-xl md:text-2xl font-bold text-foreground mb-2">Calls</h1>
        <p className="text-muted-foreground">Defaults for calls on this device.</p>
      </div>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-foreground">Ringing and joining</h2>
        <Card tone="surface" className="space-y-4 p-4">
          {toggles.map(({ label, description, checked, change }, index) => (
            <div
              key={label}
              className={cn(
                "flex items-center justify-between gap-6",
                index > 0 && "border-t border-border pt-4",
              )}
            >
              <div>
                <div className="font-medium text-foreground">{label}</div>
                <div className="text-sm font-medium text-muted-foreground">{description}</div>
              </div>
              <ToggleSwitch
                enabled={checked}
                onChange={(value) => dispatch(change(value))}
                ariaLabel={label}
              />
            </div>
          ))}
        </Card>
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Default devices</h2>
          <p className="text-sm font-medium text-muted-foreground">
            Used for your next call. Unavailable devices fall back to system defaults.
          </p>
        </div>
        <Card tone="surface" className="space-y-4 p-4">
          {devices.map(({ label, items, value, change }) => {
            const managedByBrowser = label === "Speaker" && !speakerSelectionSupported;
            return (
              <div key={label} className="grid items-center gap-2 sm:grid-cols-[8rem_1fr]">
                <span className="text-sm text-muted-foreground">{label}</span>
                <Select
                  ariaLabel={`Default ${label.toLowerCase()}`}
                  value={selectedDevice(items, value)}
                  disabled={managedByBrowser}
                  onChange={(id) => dispatch(change(id || null))}
                  options={deviceOptions(label, items, managedByBrowser)}
                  className="min-w-0"
                  triggerClassName="w-full min-w-0"
                />
              </div>
            );
          })}
          <div className="space-y-2 border-t border-border pt-4">
            <Button variant="outline" onClick={() => void revealDevices()} loading={requesting}>
              Allow device access
            </Button>
            <p className="text-xs text-muted-foreground">
              Browser permission reveals device names. Preview capture stops immediately.
            </p>
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </Card>
      </section>

      <p className="text-sm text-muted-foreground">
        Type{" "}
        <kbd className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">
          /call
        </kbd>{" "}
        in a channel to open call setup.{" "}
        <Link to="/settings?section=shortcuts" className="text-primary hover:underline">
          Customize call shortcuts
        </Link>
      </p>
    </div>
  );
}
