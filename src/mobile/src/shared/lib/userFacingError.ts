import { ConnectError } from "@connectrpc/connect";

/**
 * The server writes its validation refusals as readable sentences, so those are
 * shown as-is; every other failure carries internals and gets the fallback.
 */
export function userFacingError(error: unknown, fallback: string): string {
  if (!(error instanceof ConnectError)) return fallback;
  return error.rawMessage.match(/Validation error on '[^']+': (.+)/)?.[1] ?? fallback;
}
