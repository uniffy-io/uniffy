import { useCallback, useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { ScreenShareQuality } from "@uniffy/proto/calls/v1/calls_pb";

interface Pref<T> {
  get(): Promise<T>;
  set(value: T): Promise<void>;
  /** Last known value without touching storage, so a hook can paint before the read lands. */
  cached(): T;
  subscribe(listener: (value: T) => void): () => void;
}

function definePref<T>(
  key: string,
  fallback: T,
  decode: (raw: string) => T,
  encode: (value: T) => string,
): Pref<T> {
  let cache: T | undefined;
  // One preference can be read by two surfaces at once - a picker and the row
  // that summarises it - so a write has to reach every hook instance, not just
  // the one that made it.
  const listeners = new Set<(value: T) => void>();
  return {
    async get() {
      if (cache !== undefined) return cache;
      try {
        const raw = await AsyncStorage.getItem(key);
        cache = raw === null ? fallback : decode(raw);
      } catch {
        cache = fallback;
      }
      return cache;
    },
    async set(value: T) {
      cache = value;
      for (const listener of listeners) listener(value);
      try {
        await AsyncStorage.setItem(key, encode(value));
      } catch {
        // Preference survives only the session; acceptable.
      }
    },
    cached() {
      return cache ?? fallback;
    },
    subscribe(listener: (value: T) => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

function usePref<T>(pref: Pref<T>): [T, (value: T) => void] {
  const [value, setValue] = useState(pref.cached());

  useEffect(() => {
    void pref.get().then(setValue);
    return pref.subscribe(setValue);
  }, [pref]);

  const update = useCallback(
    (next: T) => {
      void pref.set(next);
    },
    [pref],
  );

  return [value, update];
}

const ringtonePref = definePref<boolean>(
  "uniffy_call_ringtone_enabled",
  true,
  (raw) => raw !== "false",
  (enabled) => (enabled ? "true" : "false"),
);

const QUALITY_VALUES: ScreenShareQuality[] = [
  ScreenShareQuality.UNSPECIFIED,
  ScreenShareQuality.BALANCED,
  ScreenShareQuality.HIGH,
  ScreenShareQuality.MAX,
];

// UNSPECIFIED means "follow the org cap" rather than "no opinion yet", so it is
// both the fallback and a value the user can deliberately pick back.
const screenSharePref = definePref<ScreenShareQuality>(
  "uniffy_call_screen_share_quality",
  ScreenShareQuality.UNSPECIFIED,
  (raw) => {
    const parsed = Number(raw);
    return QUALITY_VALUES.includes(parsed) ? parsed : ScreenShareQuality.UNSPECIFIED;
  },
  (quality) => String(quality),
);

// null leaves routing to LiveKit's own preference order (bluetooth, headset,
// speaker, earpiece) rather than pinning a device that may not be connected.
const audioOutputPref = definePref<string | null>(
  "uniffy_call_audio_output",
  null,
  (raw) => raw || null,
  (deviceId) => deviceId ?? "",
);

export type CameraFit = "fit" | "fill";

// The capture is a 3:4 portrait frame and every tile it lands in is a different
// shape, so filling one always crops. "fit" is the default because it shows what
// is actually being transmitted; "fill" is there for people who prefer the
// edge-to-edge look and do not mind losing the sides.
const cameraFitPref = definePref<CameraFit>(
  "uniffy_call_camera_fit",
  "fit",
  (raw) => (raw === "fill" ? "fill" : "fit"),
  (fit) => fit,
);

export function useCameraFit(): [CameraFit, (fit: CameraFit) => void] {
  return usePref(cameraFitPref);
}

export function getRingtoneEnabled(): Promise<boolean> {
  return ringtonePref.get();
}

export function setRingtoneEnabled(enabled: boolean): Promise<void> {
  return ringtonePref.set(enabled);
}

export function useRingtoneEnabled(): [boolean, (enabled: boolean) => void] {
  return usePref(ringtonePref);
}

export function getScreenShareQuality(): Promise<ScreenShareQuality> {
  return screenSharePref.get();
}

export function useScreenShareQuality(): [
  ScreenShareQuality,
  (quality: ScreenShareQuality) => void,
] {
  return usePref(screenSharePref);
}

export function getPreferredAudioOutput(): Promise<string | null> {
  return audioOutputPref.get();
}

export function setPreferredAudioOutput(deviceId: string | null): Promise<void> {
  return audioOutputPref.set(deviceId);
}

export function usePreferredAudioOutput(): [string | null, (deviceId: string | null) => void] {
  return usePref(audioOutputPref);
}
