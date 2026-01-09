/**
 * API Configuration
 * 
 * Centralized ConnectRPC transport creation and configuration.
 * Use the exported transport instance for all API calls.
 */

import { createConnectTransport } from '@connectrpc/connect-web';
import type { Interceptor } from '@connectrpc/connect';
import { ConnectError, Code } from '@connectrpc/connect';
import { env } from './env';

/**
 * Auth interceptor that handles token expiration and authentication errors.
 * Redirects to login page when tokens expire or authentication fails.
 */
const authInterceptor: Interceptor = (next) => async (req) => {
  try {
    return await next(req);
  } catch (error) {
    // Check if error is a ConnectError with UNAUTHENTICATED code
    if (error instanceof ConnectError && error.code === Code.Unauthenticated) {
      // Clear auth state from localStorage
      localStorage.removeItem('persist:root');

      // Redirect to login page
      window.location.href = '/auth';

      // Re-throw the error
      throw error;
    }

    // For other errors, just re-throw
    throw error;
  }
};

/**
 * Shared ConnectRPC transport instance.
 * 
 * This transport is configured with the base API URL from environment config
 * and includes an interceptor for handling authentication errors.
 * 
 * When a token expires or authentication fails, the interceptor automatically:
 * - Clears stored credentials
 * - Redirects the user to the login page
 * 
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
  interceptors: [authInterceptor],
});
