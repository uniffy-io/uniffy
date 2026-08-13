import { ConnectError, Code } from '@connectrpc/connect';

/** True when a call ended because its AbortSignal fired.
 *  ConnectRPC surfaces that as `Code.Canceled`; a fetch aborted before the
 *  client wraps it still arrives as a DOMException, so both are checked. */
export function isCanceledError(error: unknown): boolean {
    if (error instanceof ConnectError) {
        return error.code === Code.Canceled;
    }
    return error instanceof Error && error.name === 'AbortError';
}
