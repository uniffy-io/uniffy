// Decodes the JWT exp claim without verifying - the client only needs the
// expiry instant to schedule a refresh. Manual base64url decode because atob
// is not guaranteed across every Hermes/react-native-web combination.
const B64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function base64UrlDecode(input: string): string {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  let out = "";
  let buffer = 0;
  let bits = 0;
  for (const char of normalized) {
    if (char === "=") break;
    const value = B64_ALPHABET.indexOf(char);
    if (value < 0) continue;
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out += String.fromCharCode((buffer >> bits) & 0xff);
    }
  }
  return out;
}

export function getTokenExpiryMs(token: string): number | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(base64UrlDecode(parts[1])) as { exp?: number };
    if (typeof payload.exp !== "number") return null;
    return payload.exp * 1000;
  } catch {
    return null;
  }
}

const EXPIRY_BUFFER_MS = 60_000;

// A buffer so a request never leaves with a token that dies in flight.
export function isTokenExpiring(token: string): boolean {
  const expiry = getTokenExpiryMs(token);
  if (expiry === null) return false;
  return expiry - EXPIRY_BUFFER_MS <= Date.now();
}
