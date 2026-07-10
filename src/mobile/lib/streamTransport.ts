import { createConnectTransport } from "@connectrpc/connect-web";
import type { Interceptor } from "@connectrpc/connect";
import { fetch as expoFetch } from "expo/fetch";
import { ENV } from "@/constants/env";
import { getAccessToken } from "@/lib/auth";

const authInterceptor: Interceptor = (next) => async (req) => {
  const token = getAccessToken();
  if (token) {
    req.header.set("Authorization", `Bearer ${token}`);
  }
  return next(req);
};

// expo/fetch (WinterCG fetch) supports streaming response bodies, which React
// Native's built-in fetch does not. Server-streaming RPCs must use this
// transport; unary RPCs stay on lib/transport.
export const streamTransport = createConnectTransport({
  baseUrl: ENV.apiUrl,
  interceptors: [authInterceptor],
  fetch: expoFetch as unknown as typeof globalThis.fetch,
});
