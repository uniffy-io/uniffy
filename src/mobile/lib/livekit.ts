// Web build of the platform gate. The LiveKit native module does not exist on
// react-native-web (`run.sh mobile-dev`), so calls are unavailable there and
// every hook below is a no-op. Metro picks livekit.native.ts on iOS/Android.
import type { ComponentType } from "react";
import type { VideoTrackViewProps } from "@/lib/livekitTypes";

export const callsSupported = false;

export function loadLivekitClient(): typeof import("livekit-client") | null {
  return null;
}

export function setupLiveKit(): void {}

export async function startCallAudio(_videoEnabled: boolean): Promise<void> {}

export async function stopCallAudio(): Promise<void> {}

export async function setSpeakerphoneOn(_on: boolean): Promise<void> {}

export const VideoTrackView: ComponentType<VideoTrackViewProps> = () => null;
