import type { AppDispatch } from "@/app/store";
import { friendlyErrorMessage } from "@/config/errorMessages";
import { completeCalendarConnection } from "@/features/calendar/store/calendarConnectionsThunks";
import { connectionsPath } from "@/features/calendar/utils/connectionRoutes";

export const CALENDAR_HOME = "/calendar";
export const INCOMPLETE_CALLBACK =
  "This sign-in link is incomplete. Start connecting the account again.";
const FALLBACK_FAILURE = "The calendar account could not be connected. Try again.";

export interface CallbackRequest {
  code: string;
  state: string;
  error: string;
  errorDescription: string;
}

/** What the provider appended to the callback address, or null when it cannot complete anything. */
export function callbackRequest(params: URLSearchParams): CallbackRequest | null {
  const request = {
    code: params.get("code") ?? "",
    state: params.get("state") ?? "",
    error: params.get("error") ?? "",
    errorDescription: params.get("error_description") ?? "",
  };
  return request.state && (request.code || request.error) ? request : null;
}

type Completion = ReturnType<ReturnType<typeof completeCalendarConnection>>;

/**
 * The server spends a sign-in state on first use, so a second call for the same state (strict
 * mode's repeated effect, a remount) shares the first call rather than making its own.
 */
const completions = new Map<string, Completion>();

export function completeOnce(dispatch: AppDispatch, request: CallbackRequest): Completion {
  const existing = completions.get(request.state);
  if (existing) return existing;
  const completion = dispatch(completeCalendarConnection(request));
  completions.set(request.state, completion);
  // An aborted call (session or organization reset) never reached a verdict, so a remount retries.
  void completion.then((outcome) => {
    if (
      completeCalendarConnection.rejected.match(outcome) &&
      outcome.meta.aborted &&
      completions.get(request.state) === completion
    ) {
      completions.delete(request.state);
    }
  });
  return completion;
}

/** Calendar pages open the new account's settings on arrival; any other page is returned to as it was. */
export function callbackDestination(returnPath: string, connectionId: string): string {
  const path = returnPath || CALENDAR_HOME;
  const onCalendar =
    path === CALENDAR_HOME ||
    path.startsWith(`${CALENDAR_HOME}?`) ||
    path.startsWith(`${CALENDAR_HOME}/`);
  return onCalendar ? connectionsPath(connectionId, path) : path;
}

/** The server words refusals for members; anything else gets a generic line. */
export function callbackFailureMessage(raw: unknown): string {
  return friendlyErrorMessage(typeof raw === "string" ? raw : "") ?? FALLBACK_FAILURE;
}
