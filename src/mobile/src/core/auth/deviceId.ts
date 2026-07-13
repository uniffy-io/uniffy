import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import Constants from "expo-constants";

const DEVICE_ID_KEY = "uniffy_device_id";

let cached: string | null = null;

function generateUuid(): string {
  const webCrypto = globalThis.crypto;
  if (webCrypto?.randomUUID) return webCrypto.randomUUID();
  // Not cryptographically strong, but the device id only namespaces call
  // participant rows (identity = "{user_id}:{device_id}").
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export async function getDeviceId(): Promise<string> {
  if (cached) return cached;
  try {
    const stored = await AsyncStorage.getItem(DEVICE_ID_KEY);
    if (stored) {
      cached = stored;
      return stored;
    }
    const fresh = generateUuid();
    await AsyncStorage.setItem(DEVICE_ID_KEY, fresh);
    cached = fresh;
    return fresh;
  } catch {
    // Storage unavailable: keep a per-launch id so calls still work; the
    // backend caps devices per user, and a new id after restart is harmless.
    cached = cached ?? generateUuid();
    return cached;
  }
}

export function getDeviceLabel(): string {
  const device = Constants.deviceName?.trim();
  if (device) return device.slice(0, 120);
  return Platform.OS === "ios" ? "iPhone" : "Android";
}
