import { Fragment } from "react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { controlShellClass } from "@/components/ui/input";
import { ToggleSwitch } from "@/components/ui/toggle-switch";
import { useCall } from "@/features/calls/components/callContext";
import { useDevices } from "@/features/calls/hooks/useDevices";
import {
  audioInputSelected,
  audioOutputSelected,
  videoInputSelected,
  selectCallPreferences,
} from "@/features/calls/store/callPreferencesSlice";
import { cn } from "@/shared/utils/cn";
import { BLUR_UNSUPPORTED_HINT, useBackgroundBlur } from "@/features/calls/hooks/useBackgroundBlur";
import { BlurStrengthControl } from "@/features/calls/components/BlurStrengthControl";
import {
  NOISE_SUPPRESSION_UNSUPPORTED_HINT,
  useNoiseSuppression,
} from "@/features/calls/hooks/useNoiseSuppression";

function SwitchRow({
  label,
  enabled,
  onChange,
  disabled,
  title,
}: {
  label: string;
  enabled: boolean;
  onChange: (enabled: boolean) => void;
  disabled: boolean;
  title?: string;
}) {
  return (
    <label
      className="flex min-h-11 cursor-pointer items-center justify-between gap-3 text-sm text-foreground lg:min-h-9"
      title={title}
    >
      <span>{label}</span>
      <ToggleSwitch
        size="sm"
        enabled={enabled}
        onChange={onChange}
        disabled={disabled}
        ariaLabel={label}
      />
    </label>
  );
}

export function CallDeviceSettings() {
  const dispatch = useAppDispatch();
  const { switchDevice } = useCall();
  const { audioInputs, videoInputs, audioOutputs } = useDevices();
  const preferences = useAppSelector(selectCallPreferences);
  const {
    blur,
    supported: blurSupported,
    available: blurAvailable,
    setBlur,
    strength: blurStrength,
    setStrength: setBlurStrength,
  } = useBackgroundBlur();
  const noise = useNoiseSuppression();
  const fields = [
    {
      label: "Microphone",
      kind: "audioinput" as const,
      devices: audioInputs,
      selected: preferences.audioInputId,
      action: audioInputSelected,
    },
    {
      label: "Camera",
      kind: "videoinput" as const,
      devices: videoInputs,
      selected: preferences.videoInputId,
      action: videoInputSelected,
    },
    {
      label: "Speaker",
      kind: "audiooutput" as const,
      devices: audioOutputs,
      selected: preferences.audioOutputId,
      action: audioOutputSelected,
    },
  ];
  return (
    <div className="space-y-3 p-3">
      {fields.map(({ label, kind, devices, selected, action }) => (
        <Fragment key={kind}>
          <label className="block space-y-1 text-xs text-muted-foreground">
            <span>{label}</span>
            <select
              aria-label={label}
              className={cn(
                controlShellClass,
                "focus-ring min-h-11 w-full px-2 text-sm text-foreground lg:min-h-9",
              )}
              value={
                devices.some((device) => device.deviceId === selected)
                  ? selected!
                  : (devices[0]?.deviceId ?? "")
              }
              disabled={!devices.length}
              onChange={(event) => {
                dispatch(action(event.target.value));
                void switchDevice(kind, event.target.value);
              }}
            >
              {!devices.length && <option value="">No devices found</option>}
              {devices.map((device, index) => (
                <option key={device.deviceId || index} value={device.deviceId}>
                  {device.label || `${label} ${index + 1}`}
                </option>
              ))}
            </select>
          </label>
          {kind === "audioinput" && (
            <SwitchRow
              label="Noise suppression"
              enabled={noise.enabled}
              onChange={noise.setEnabled}
              disabled={!noise.supported}
              title={noise.supported ? undefined : NOISE_SUPPRESSION_UNSUPPORTED_HINT}
            />
          )}
          {kind === "videoinput" && (
            <SwitchRow
              label="Blur background"
              enabled={blur}
              onChange={setBlur}
              disabled={!blurAvailable}
              title={blurSupported === false && !blur ? BLUR_UNSUPPORTED_HINT : undefined}
            />
          )}
          {kind === "videoinput" && blur && (
            <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
              <span>Strength</span>
              <BlurStrengthControl value={blurStrength} onChange={setBlurStrength} />
            </div>
          )}
        </Fragment>
      ))}
    </div>
  );
}
