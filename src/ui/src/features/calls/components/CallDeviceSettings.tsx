import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { controlShellClass } from "@/components/ui/input";
import { useCall } from "@/features/calls/components/callContext";
import { useDevices } from "@/features/calls/hooks/useDevices";
import {
  audioInputSelected,
  audioOutputSelected,
  videoInputSelected,
  selectCallPreferences,
} from "@/features/calls/store/callPreferencesSlice";
import { cn } from "@/shared/utils/cn";

export function CallDeviceSettings() {
  const dispatch = useAppDispatch();
  const { switchDevice } = useCall();
  const { audioInputs, videoInputs, audioOutputs } = useDevices();
  const preferences = useAppSelector(selectCallPreferences);
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
        <label key={kind} className="block space-y-1 text-xs text-muted-foreground">
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
      ))}
    </div>
  );
}
