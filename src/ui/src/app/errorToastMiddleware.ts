import type { Middleware } from '@reduxjs/toolkit';
import { isRejectedWithValue, isRejected } from '@reduxjs/toolkit';
import { toast } from 'sonner';
import { friendlyErrorMessage } from '@/config/errorMessages';

/**
 * Redux middleware that catches rejected async thunks and shows
 * user-friendly error toasts.
 *
 * - rejectWithValue payloads and thrown error messages are both
 *   run through `friendlyErrorMessage` so raw codes like
 *   "[unknown] 500" become readable sentences.
 * - Returns `null` for errors that should be suppressed (aborts, etc.).
 */
export const errorToastMiddleware: Middleware = () => (next) => (action) => {
    const result = next(action);

    let raw: string | undefined;

    if (isRejectedWithValue(action)) {
        raw = String(action.payload);
    } else if (isRejected(action) && action.error?.message) {
        raw = action.error.message;
    }

    if (raw) {
        const friendly = friendlyErrorMessage(raw);
        if (friendly) {
            toast.error(friendly);
        }
    }

    return result;
};
