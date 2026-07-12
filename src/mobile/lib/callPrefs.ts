import { useCallback, useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

const RINGTONE_KEY = "uniffy_call_ringtone_enabled";

let ringtoneCache: boolean | null = null;

export async function getRingtoneEnabled(): Promise<boolean> {
  if (ringtoneCache !== null) return ringtoneCache;
  try {
    const stored = await AsyncStorage.getItem(RINGTONE_KEY);
    ringtoneCache = stored !== "false";
  } catch {
    ringtoneCache = true;
  }
  return ringtoneCache;
}

export async function setRingtoneEnabled(enabled: boolean): Promise<void> {
  ringtoneCache = enabled;
  try {
    await AsyncStorage.setItem(RINGTONE_KEY, enabled ? "true" : "false");
  } catch {
    // Preference survives only the session; acceptable.
  }
}

export function useRingtoneEnabled(): [boolean, (enabled: boolean) => void] {
  const [enabled, setEnabled] = useState(ringtoneCache ?? true);

  useEffect(() => {
    void getRingtoneEnabled().then(setEnabled);
  }, []);

  const update = useCallback((value: boolean) => {
    setEnabled(value);
    void setRingtoneEnabled(value);
  }, []);

  return [enabled, update];
}
