const apiUrl = process.env.EXPO_PUBLIC_API_URL;

if (!apiUrl && __DEV__) {
  console.warn("EXPO_PUBLIC_API_URL is not set - defaulting to http://localhost:8000/api");
}

export const ENV = {
  apiUrl: apiUrl ?? "http://localhost:8000/api",
  // Absolute ws(s):// override for LiveKit signaling. Needed when the API URL
  // points at the backend port directly (the backend does not proxy /livekit);
  // point EXPO_PUBLIC_API_URL at the edge proxy instead, or set e.g.
  // EXPO_PUBLIC_LIVEKIT_URL=ws://<lan-ip>:7880 for dev.
  livekitUrl: process.env.EXPO_PUBLIC_LIVEKIT_URL ?? "",
} as const;
