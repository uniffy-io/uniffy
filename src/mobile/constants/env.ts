const apiUrl = process.env.EXPO_PUBLIC_API_URL;

if (!apiUrl && __DEV__) {
  console.warn("EXPO_PUBLIC_API_URL is not set - defaulting to http://localhost:8000/api");
}

export const ENV = {
  apiUrl: apiUrl ?? "http://localhost:8000/api",
} as const;
