// Web build of the platform gate. The LiveKit native module does not exist on
// react-native-web (`./manage.py serve mobile --web`), so calls are unavailable
// there and every hook below is a no-op. Metro picks livekit.native.ts on
// iOS/Android.
import type { ComponentType } from "react";
import type { LocalVideoPreviewProps, VideoTrackViewProps } from "@features/calls/livekitTypes";

export const callsSupported = false;

export function loadLivekitClient(): typeof import("livekit-client") | null {
  return null;
}

export function setupLiveKit(): void {}

export async function startCallAudio(_videoEnabled: boolean, _micEnabled: boolean): Promise<void> {}

export function startCallMicService(): void {}

export async function stopCallAudio(): Promise<void> {}

export async function startPreviewAudio(): Promise<void> {}

export async function stopPreviewAudio(): Promise<void> {}

export async function getAudioOutputs(): Promise<string[]> {
  return [];
}

export async function selectAudioOutput(_deviceId: string): Promise<void> {}

export async function showAudioRoutePicker(): Promise<void> {}

export function isScreenShareAvailable(): boolean {
  return false;
}

export async function presentScreenSharePicker(): Promise<void> {
  throw new Error("Screen share picker unavailable");
}

export const VideoTrackView: ComponentType<VideoTrackViewProps> = () => null;

export const LocalVideoPreview: ComponentType<LocalVideoPreviewProps> = () => null;
