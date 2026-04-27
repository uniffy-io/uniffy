/**
 * User-friendly error message mapping.
 *
 * Translates raw API / network errors into messages that make sense
 * to non-technical users.  Used by the global error-toast middleware.
 */

/** ConnectRPC / gRPC status codes mapped to friendly messages. */
const STATUS_CODE_MESSAGES: Record<string, string> = {
    // 4xx-equivalent
    unauthenticated: 'Your session has expired. Please sign in again.',
    permission_denied: 'You do not have permission to perform this action.',
    not_found: 'The item you requested could not be found.',
    already_exists: 'This item already exists.',
    invalid_argument: 'Some of the information provided is invalid.',
    failed_precondition: 'This action cannot be performed right now.',
    out_of_range: 'The value provided is out of the allowed range.',
    resource_exhausted: 'Too many requests. Please wait a moment and try again.',

    // 5xx-equivalent
    internal: 'Something went wrong on our end. Please try again shortly.',
    unavailable: 'The server is temporarily unavailable. Please try again in a moment.',
    unimplemented: 'This feature is not available yet.',
    unknown: 'An unexpected error occurred. Please try again.',
    data_loss: 'Something went wrong on our end. Please try again shortly.',
    deadline_exceeded: 'The request took too long. Please try again.',
};

/** HTTP status codes (used by fetch / non-RPC calls). */
const HTTP_STATUS_MESSAGES: Record<number, string> = {
    400: 'The request was invalid. Please check your input and try again.',
    401: 'Your session has expired. Please sign in again.',
    403: 'You do not have permission to perform this action.',
    404: 'The item you requested could not be found.',
    408: 'The request timed out. Please try again.',
    409: 'This conflicts with another change. Please refresh and try again.',
    413: 'The file is too large to upload.',
    429: 'Too many requests. Please wait a moment and try again.',
    500: 'Something went wrong on our end. Please try again shortly.',
    502: 'The server is temporarily unavailable. Please try again in a moment.',
    503: 'The server is temporarily unavailable. Please try again in a moment.',
    504: 'The request took too long. Please try again.',
};

/** Patterns matched against the raw error string. */
const MESSAGE_PATTERNS: [RegExp, string][] = [
    [/fetch failed|failed to fetch|networkerror/i, 'Could not connect to the server. Please check your internet connection.'],
    [/timeout|timed?\s*out/i, 'The request timed out. Please try again.'],
    [/abort/i, ''],  // empty = suppress (handled separately by middleware)
];

/**
 * Turn a raw error message into something a human can read.
 *
 * Returns `null` when the error should be suppressed entirely
 * (e.g. aborted requests).
 */
export function friendlyErrorMessage(raw: string): string | null {
    if (!raw) return null;

    const lower = raw.toLowerCase().trim();

    // 1. Suppress noisy non-errors
    if (lower === 'rejected' || lower === 'aborted' || lower === 'aborterror') {
        return null;
    }

    // 2. Try to extract a ConnectRPC status code  e.g. "[internal] ..." or "[unknown] 500"
    const codeMatch = lower.match(/^\[(\w+)]/);
    if (codeMatch) {
        const code = codeMatch[1];
        // For these codes, prefer the server's specific message
        if (code === 'failed_precondition' || code === 'invalid_argument') {
            let serverMsg = raw.replace(/^\[\w+]\s*/, '').trim();
            // Strip technical prefix: "Validation error on 'field': actual message"
            serverMsg = serverMsg.replace(/^Validation error on '\w+':\s*/i, '');
            return serverMsg || STATUS_CODE_MESSAGES[code];
        }
        if (STATUS_CODE_MESSAGES[code]) {
            return STATUS_CODE_MESSAGES[code];
        }
    }

    // 3. Try to match an HTTP status code  e.g. "500", "Request failed with status 503"
    const httpMatch = lower.match(/\b(4\d{2}|5\d{2})\b/);
    if (httpMatch) {
        const status = Number(httpMatch[1]);
        if (HTTP_STATUS_MESSAGES[status]) {
            return HTTP_STATUS_MESSAGES[status];
        }
        if (status >= 500) {
            return 'Something went wrong on our end. Please try again shortly.';
        }
    }

    // 4. Try regex patterns
    for (const [pattern, message] of MESSAGE_PATTERNS) {
        if (pattern.test(raw)) {
            return message || null;
        }
    }

    // 5. Fall through: return the original message as-is (it may already be
    //    a decent user-facing string set via rejectWithValue).
    return raw;
}
