import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import AsyncStorage from "@react-native-async-storage/async-storage";

const REFRESH_TOKEN_KEY = "uniffy_refresh_token";
const ORG_ID_KEY = "uniffy_organization_id";

// expo-secure-store has no web backend; fall back to AsyncStorage there.
const useSecureStore = Platform.OS !== "web";

// Available for background work after first unlock, but never leaves this
// device: no iCloud keychain sync and no device-transfer restore of the
// refresh token (iOS-only knob; Android Keystore keys are device-bound).
const secureStoreOptions: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

async function getItem(key: string): Promise<string | null> {
  if (useSecureStore) return SecureStore.getItemAsync(key);
  return AsyncStorage.getItem(key);
}

async function setItem(key: string, value: string): Promise<void> {
  if (useSecureStore) {
    await SecureStore.setItemAsync(key, value, secureStoreOptions);
    return;
  }
  await AsyncStorage.setItem(key, value);
}

async function deleteItem(key: string): Promise<void> {
  if (useSecureStore) {
    await SecureStore.deleteItemAsync(key);
    return;
  }
  await AsyncStorage.removeItem(key);
}

// Access token lives in memory only - it is short-lived and re-minted from the
// persisted refresh token on every cold start (see AuthProvider rehydrate).
let accessToken: string | null = null;

export function getAccessToken(): string | null {
  return accessToken;
}

export function setAccessToken(token: string): void {
  accessToken = token;
}

// The asset-read cookie pair ("name=token") delivered in auth response bodies.
// GET asset requests attach it as an explicit Cookie header (see
// core/auth/assetAuth.ts). Memory-only like the access token: it is re-minted
// on every refresh and never persisted.
let assetCookie: string | null = null;

export function getAssetCookie(): string | null {
  return assetCookie;
}

export function setAssetCookie(pair: string | null): void {
  assetCookie = pair || null;
}

export function getRefreshToken(): Promise<string | null> {
  return getItem(REFRESH_TOKEN_KEY);
}

export function setRefreshToken(token: string): Promise<void> {
  return setItem(REFRESH_TOKEN_KEY, token);
}

export function getStoredOrgId(): Promise<string | null> {
  return getItem(ORG_ID_KEY);
}

export function setStoredOrgId(orgId: string): Promise<void> {
  return setItem(ORG_ID_KEY, orgId);
}

export async function clearAuthStorage(): Promise<void> {
  accessToken = null;
  assetCookie = null;
  await Promise.all([deleteItem(REFRESH_TOKEN_KEY), deleteItem(ORG_ID_KEY)]);
}
