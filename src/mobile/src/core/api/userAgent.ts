import { Platform } from "react-native";
import Constants from "expo-constants";

// A default React Native / CFNetwork user agent carries no browser or OS token
// the backend session parser recognizes, so native logins show as "Unknown
// device". Send an explicit agent it can label. On web the real browser UA is
// more useful, so leave it untouched.
export function clientUserAgent(): string | null {
  if (Platform.OS === "web") return null;
  const version = Constants.expoConfig?.version ?? "0";
  const os = Platform.OS === "ios" ? "iOS" : Platform.OS === "android" ? "Android" : Platform.OS;
  const osVersion = String(Platform.Version ?? "").trim();
  const platform = osVersion ? `${os} ${osVersion}` : os;
  return `Uniffy/${version} (${platform})`;
}
