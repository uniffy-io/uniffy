import type { Middleware } from "@reduxjs/toolkit";
import { isAction, isRejectedWithValue, isRejected } from "@reduxjs/toolkit";
import { toast } from "sonner";
import { friendlyErrorMessage } from "@/config/errorMessages";

// These pages render their own not-found state (a redirect or the wrong-organization notice), so
// the generic toast would contradict what the page shows.
const PAGE_OWNED_NOT_FOUND = new Set([
  "notes/fetchNote/rejected",
  "chat/fetchChannel/rejected",
  "projects/fetchProject/rejected",
]);
const NOT_FOUND_CODE = /\[not_found\]/i;

/** Catches rejected thunks, translates raw payloads/errors via `friendlyErrorMessage`, suppresses aborts. */
export const errorToastMiddleware: Middleware = () => (next) => (action) => {
  const result = next(action);

  let raw: string | undefined;

  if (isRejectedWithValue(action)) {
    raw = String(action.payload);
  } else if (isRejected(action) && action.error?.message) {
    raw = action.error.message;
  }

  if (
    raw &&
    isAction(action) &&
    PAGE_OWNED_NOT_FOUND.has(action.type) &&
    NOT_FOUND_CODE.test(raw)
  ) {
    return result;
  }

  if (raw) {
    const friendly = friendlyErrorMessage(raw);
    if (friendly) {
      toast.error(friendly);
    }
  }

  return result;
};
