/**
 * Enumerate microphone devices for the popover picker.
 *
 * Browsers withhold device labels until the user has granted *some* mic
 * permission to the origin in the past. We do not force a permission prompt
 * on popover open; if labels come back blank we fall back to a generic name
 * with the device id suffix so the user can still pick one. Once they record
 * once with the mic on, subsequent popover opens get real labels.
 */

export interface MicrophoneDevice {
    deviceId: string;
    label: string;
}

export async function listMicrophones(): Promise<MicrophoneDevice[]> {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) {
        return [];
    }
    try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        return devices
            .filter((device) => device.kind === 'audioinput')
            .map((device) => {
                if (device.label) {
                    return { deviceId: device.deviceId, label: device.label };
                }
                const suffix = device.deviceId ? device.deviceId.slice(0, 6) : '';
                return {
                    deviceId: device.deviceId,
                    label: suffix ? `Microphone (${suffix})` : 'Microphone',
                };
            });
    } catch {
        return [];
    }
}
