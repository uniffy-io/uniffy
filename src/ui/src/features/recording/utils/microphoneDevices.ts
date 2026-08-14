/** Browsers withhold device labels until mic permission has ever been granted; fall back to id-suffix labels. */

export interface MicrophoneDevice {
  deviceId: string;
  label: string;
}

export async function listMicrophones(): Promise<MicrophoneDevice[]> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.enumerateDevices) {
    return [];
  }
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices
      .filter((device) => device.kind === "audioinput")
      .map((device) => {
        if (device.label) {
          return { deviceId: device.deviceId, label: device.label };
        }
        const suffix = device.deviceId ? device.deviceId.slice(0, 6) : "";
        return {
          deviceId: device.deviceId,
          label: suffix ? `Microphone (${suffix})` : "Microphone",
        };
      });
  } catch {
    return [];
  }
}
