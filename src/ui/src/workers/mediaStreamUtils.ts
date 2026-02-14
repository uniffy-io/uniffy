/**
 * Pure utility functions extracted from mediaStreamWorker for testability.
 *
 * These are also used by the service worker itself via re-export.
 */

// Max chunk size for initial request (2MB) - allows quick video start
export const MAX_INITIAL_CHUNK_SIZE = 2 * 1024 * 1024;

/**
 * Build a safe Content-Disposition header value.
 *
 * Non-ASCII characters in the filename cause `TypeError: Failed to construct
 * 'Response': String contains non ISO-8859-1 code point`. We produce an
 * ASCII-only `filename=` parameter (non-ASCII chars replaced with `_`) and,
 * when the original name contains non-ASCII chars, an RFC 5987
 * `filename*=UTF-8''...` parameter so capable user-agents display the
 * original Unicode name.
 */
export function buildContentDisposition(filename: string): string {
    // ASCII-safe: replace any character outside printable ASCII (and quotes/backslash) with _
    const asciiName = filename.replace(/[^\x20-\x7E]|["\\]/g, '_');

    const hasNonAscii = /[^\x20-\x7E]/.test(filename);
    if (!hasNonAscii) {
        return `inline; filename="${asciiName}"`;
    }

    // RFC 5987: percent-encode the UTF-8 representation
    const encoded = encodeURIComponent(filename).replace(/'/g, '%27');
    return `inline; filename="${asciiName}"; filename*=UTF-8''${encoded}`;
}

/**
 * Parse a Range header and determine byte range for a media request.
 *
 * Returns `hasRangeHeader` so the caller can decide between 200 and 206.
 * The 2MB initial-chunk cap is only applied when the browser explicitly sends
 * a Range header AND `requestFullFile` is false. Without a Range header from
 * the browser (e.g. `<audio>` initial load) we must request the full file so
 * the response can be returned as a normal 200 -- returning an unsolicited 206
 * causes browser media demuxers to fail.
 */
export function parseRangeRequest(
    rangeHeader: string | null,
    requestFullFile: boolean
): { startByte: number; endByte: number | undefined; hasRangeHeader: boolean } {
    let startByte: number | undefined;
    let endByte: number | undefined;
    let hasRangeHeader = false;

    if (rangeHeader) {
        hasRangeHeader = true;
        const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
        if (match) {
            startByte = parseInt(match[1], 10);
            endByte = match[2] ? parseInt(match[2], 10) : undefined;
        }
    }

    if (startByte === undefined) {
        startByte = 0;
    }

    // Only cap chunk size when the browser sent an explicit Range header and
    // this is not a full-file request. This keeps video quick-start working
    // while letting <audio> initial loads get the full file.
    if (hasRangeHeader && !requestFullFile && (endByte === undefined || endByte - startByte > MAX_INITIAL_CHUNK_SIZE)) {
        endByte = startByte + MAX_INITIAL_CHUNK_SIZE - 1;
    }

    return { startByte, endByte, hasRangeHeader };
}
