import { createElement } from "react";
import { NativeModules, Platform } from "react-native";
import { requireOptionalNativeModule } from "expo";
import type { ComponentType } from "react";
import type { VideoTrackViewProps } from "@features/calls/livekitTypes";

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

export async function startCallAudio(videoEnabled: boolean): Promise<void> {
  const lk = loadSdk();
  if (!lk) return;
  await lk.AudioSession.configureAudio({
    android: { audioTypeOptions: lk.AndroidAudioTypePresets.communication },
    ios: { defaultOutput: videoEnabled ? "speaker" : "earpiece" },
  });
  await lk.AudioSession.startAudioSession();
  // RECORD_AUDIO is while-in-use, so the service has to start here - on the
  // connect path, with the app still foregrounded. Starting it from the
  // AppState background handler is already too late.
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

export async function setSpeakerphoneOn(on: boolean): Promise<void> {
  const lk = loadSdk();
  if (!lk) return;
  if (Platform.OS === "ios") {
    await lk.AudioSession.selectAudioOutput(on ? "force_speaker" : "default");
  } else {
    await lk.AudioSession.selectAudioOutput(on ? "speaker" : "earpiece");
  }
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
