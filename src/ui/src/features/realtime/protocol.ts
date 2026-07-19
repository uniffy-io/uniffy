export const CANONICAL_SUBPROTOCOL = 'uniffy.realtime.v1';

export const WS_CLOSE_NORMAL = 1000;
export const WS_CLOSE_MESSAGE_TOO_BIG = 1009;
export const WS_CLOSE_UNAUTHENTICATED = 4401;
export const WS_CLOSE_FORBIDDEN = 4403;
export const WS_CLOSE_NOT_FOUND = 4404;
export const WS_CLOSE_IDLE = 4408;
export const WS_CLOSE_TOKEN_REVOKED = 4410;

export type RealtimeStatus =
  | 'idle'
  | 'connecting'
  | 'connected'
  // Connected or reconnecting while local frames are still queued or unsent.
  | 'syncing'
  | 'disconnected'
  | 'offline'
  | 'permission_lost'
  | 'token_revoked';

export function statusFromCloseCode(code: number): RealtimeStatus | null {
  switch (code) {
    case WS_CLOSE_FORBIDDEN:
    case WS_CLOSE_NOT_FOUND:
      return 'permission_lost';
    case WS_CLOSE_TOKEN_REVOKED:
      return 'token_revoked';
    default:
      return null;
  }
}
