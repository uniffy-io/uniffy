/**
 * API Configuration
 * 
 * Centralized ConnectRPC transport creation and configuration.
 * Use the exported transport instance for all API calls.
 */

import { createConnectTransport } from '@connectrpc/connect-web';
import { env } from './env';

/**
 * Shared ConnectRPC transport instance.
 * 
 * This transport is configured with the base API URL from environment config.
 * All API clients should use this transport to ensure consistent configuration.
 * 
 * @example
 * ```ts
 * import { createClient } from "@connectrpc/connect";
 * import { transport } from "@/config/api";
 * import { AuthService } from "@/gen/auth/v1/auth_connect";
 * 
 * const client = createClient(AuthService, transport);
 * ```
 */
export const transport = createConnectTransport({
  baseUrl: env.apiBaseUrl,
});
