import type { SelectOption } from "@/components/ui/select";

/** Browsers without `setSinkId` route call audio to their own output and cannot pick a speaker. */
export const speakerSelectionSupported =
  typeof HTMLMediaElement !== "undefined" && "setSinkId" in HTMLMediaElement.prototype;

/**
 * Choices for a call device picker: the system default first, then every device the
 * browser has named. Devices stay unnamed (empty id) until media permission is granted.
 */
export function deviceOptions(
  label: string,
  devices: MediaDeviceInfo[],
  managedByBrowser = false,
): SelectOption<string>[] {
  return [
    { value: "", label: managedByBrowser ? "Managed by browser" : "System default" },
    ...devices
      .filter((device) => device.deviceId)
      .map((device, index) => ({
        value: device.deviceId,
        label: device.label || `${label} ${index + 1}`,
      })),
  ];
}

/** The stored choice when that device is still present, otherwise the system default. */
export function selectedDevice(devices: MediaDeviceInfo[], value: string | null): string {
  return value && devices.some((device) => device.deviceId === value) ? value : "";
}
