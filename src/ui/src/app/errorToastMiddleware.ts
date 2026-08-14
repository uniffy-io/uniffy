import type { Middleware } from "@reduxjs/toolkit";
import { isRejectedWithValue, isRejected } from "@reduxjs/toolkit";
import { toast } from "sonner";
import { friendlyErrorMessage } from "@/config/errorMessages";

/** Catches rejected thunks, translates raw payloads/errors via `friendlyErrorMessage`, suppresses aborts. */
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
