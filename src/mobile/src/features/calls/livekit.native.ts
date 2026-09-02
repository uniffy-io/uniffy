import { createElement } from "react";
import { NativeModules } from "react-native";
import { requireOptionalNativeModule } from "expo";
import type { ComponentType } from "react";
import type { LocalVideoPreviewProps, VideoTrackViewProps } from "@features/calls/livekitTypes";

// The JS bundle can be newer than the installed dev client (Metro serves new
// code to an old binary). The SDK crashes at import time when its native
// modules are absent, so presence is checked first and the module loads
// lazily - a stale client degrades to calls-unavailable instead of failing
// to boot.
export const callsSupported =
  !!NativeModules.LivekitReactNativeModule && !!NativeModules.WebRTCModule;

type LiveKitSdk = typeof import("@livekit/react-native");
type LivekitClient = typeof import("livekit-client");

let sdk: LiveKitSdk | null = null;
let client: LivekitClient | null = null;

function loadSdk(): LiveKitSdk | null {
  if (!callsSupported) return null;
  if (!sdk) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    sdk = require("@livekit/react-native") as LiveKitSdk;
  }
  return sdk;
}

// livekit-client references DOMException at module scope, which Hermes lacks;
// the RN SDK installs the polyfill as an import side effect, so it must
// evaluate first. Import livekit-client values through this accessor only -
// a top-level `import { ... } from "livekit-client"` crashes unsupported
// clients at bundle evaluation.
export function loadLivekitClient(): LivekitClient | null {
  if (!loadSdk()) return null;
  if (!client) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    client = require("livekit-client") as LivekitClient;
  }
  return client;
}

let globalsRegistered = false;

export function setupLiveKit(): void {
  const lk = loadSdk();
  if (!lk || globalsRegistered) return;
  lk.registerGlobals();
  globalsRegistered = true;
}

type CallForegroundService = { start(): void; stop(): void };

// Android only, and absent from any dev client built before the local module
// existed - iOS keeps the microphone publishing under the "audio" background
// mode with no service of its own, so a null here is the normal iOS state
// rather than a failure.
const foregroundService =
  requireOptionalNativeModule<CallForegroundService>("CallForegroundService");

type ScreenSharePicker = {
  isAvailable(): boolean;
  present(timeoutMs: number): Promise<void>;
};

// iOS only: presents the system broadcast picker and reports the extension
// starting. Absent on Android, and on a dev client built before the module
// existed, so a null here means "no screen share on this binary".
const screenSharePicker = requireOptionalNativeModule<ScreenSharePicker>("ScreenSharePicker");

// Long enough to read the picker, pick Uniffy, and tap Start.
const SCREEN_SHARE_PICKER_TIMEOUT_MS = 30_000;

/** Whether the installed binary ships the broadcast extension the picker needs. */
export function isScreenShareAvailable(): boolean {
  return screenSharePicker?.isAvailable() ?? false;
}

/**
 * Resolves once the broadcast extension reports it has started; rejects when
 * the picker is dismissed, the broadcast stops first, or nothing happens in time.
 */
export async function presentScreenSharePicker(): Promise<void> {
  if (!screenSharePicker) throw new Error("Screen share picker unavailable");
  await screenSharePicker.present(SCREEN_SHARE_PICKER_TIMEOUT_MS);
}

export async function startCallAudio(videoEnabled: boolean, micEnabled: boolean): Promise<void> {
  const lk = loadSdk();
  if (!lk) return;
  await lk.AudioSession.configureAudio({
    android: { audioTypeOptions: lk.AndroidAudioTypePresets.communication },
    ios: { defaultOutput: videoEnabled ? "speaker" : "earpiece" },
  });
  await lk.AudioSession.startAudioSession();
  if (micEnabled) startCallMicService();
}

/**
 * The service declares the "microphone" foreground type, which Android 14+ only
 * lets an app start while it actually HOLDS RecordAudio - the manifest
 * permission alone is not enough. Starting it for a listen-only call throws
 * SecurityException on a binder thread and takes the whole process down, so it
 * stays off until the mic is genuinely on.
 *
 * RECORD_AUDIO is while-in-use, so this still has to happen with the app
 * foregrounded: on the connect path, or on the tap that unmutes. Starting it
 * from the AppState background handler is already too late.
 */
export function startCallMicService(): void {
  foregroundService?.start();
}

export async function stopCallAudio(): Promise<void> {
  // Ahead of the SDK check: an unsupported client never started the service,
  // and a supported one must drop the notification even if the SDK went away.
  foregroundService?.stop();
  const lk = loadSdk();
  if (!lk) return;
  await lk.AudioSession.stopAudioSession();
}

/**
 * getAudioOutputs only reports routes once a session is running, and the call's
 * own session does not start until the join. Pre-join borrows one to populate the
 * route list, without the microphone service a real call would need.
 */
export async function startPreviewAudio(): Promise<void> {
  const lk = loadSdk();
  if (!lk) return;
  await lk.AudioSession.configureAudio({
    android: { audioTypeOptions: lk.AndroidAudioTypePresets.communication },
  });
  await lk.AudioSession.startAudioSession();
}

export async function stopPreviewAudio(): Promise<void> {
  const lk = loadSdk();
  if (!lk) return;
  await lk.AudioSession.stopAudioSession();
}

export async function getAudioOutputs(): Promise<string[]> {
  const lk = loadSdk();
  if (!lk) return [];
  return lk.AudioSession.getAudioOutputs();
}

export async function selectAudioOutput(deviceId: string): Promise<void> {
  const lk = loadSdk();
  if (!lk) return;
  await lk.AudioSession.selectAudioOutput(deviceId);
}

/** iOS only: the system route picker for headsets, Bluetooth and AirPlay. */
export async function showAudioRoutePicker(): Promise<void> {
  const lk = loadSdk();
  if (!lk) return;
  await lk.AudioSession.showAudioRoutePicker();
}

// Plain .ts on purpose: Metro resolves extensions in sourceExts order (ts
// before tsx) and tries platform variants within each, so a livekit.native.tsx
// would LOSE to the plain livekit.ts web stub on Android and silently disable
// calls. createElement keeps this file JSX-free.
export const VideoTrackView: ComponentType<VideoTrackViewProps> = (props) => {
  const lk = loadSdk();
  if (!lk) return null;
  const Video = lk.VideoTrack as unknown as ComponentType<VideoTrackViewProps>;
  return createElement(Video, props);
};

// VideoTrack needs a participant and a publication, which a pre-join track has
// neither of. VideoView is deprecated but it is the only component that renders a
// bare track, so it stays until the SDK offers a replacement.
export const LocalVideoPreview: ComponentType<LocalVideoPreviewProps> = ({ track, ...rest }) => {
  const lk = loadSdk();
  if (!lk || !track) return null;
  const Video = lk.VideoView as unknown as ComponentType<
    Omit<LocalVideoPreviewProps, "track"> & { videoTrack: LocalVideoPreviewProps["track"] }
  >;
  return createElement(Video, { ...rest, videoTrack: track });
};
