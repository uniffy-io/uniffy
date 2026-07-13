import { createConnectTransport } from "@connectrpc/connect-web";
import type { Interceptor } from "@connectrpc/connect";
import { ENV } from "@core/config/env";
import { getAccessToken } from "@core/auth/auth";

const authInterceptor: Interceptor = (next) => async (req) => {
  const token = getAccessToken();
  if (token) {
    req.header.set("Authorization", `Bearer ${token}`);
  }
  return next(req);
};

export const transport = createConnectTransport({
  baseUrl: ENV.apiUrl,
  interceptors: [authInterceptor],
});
