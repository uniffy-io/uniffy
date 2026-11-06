import type {
  CalendarSubscriptionError,
  CalendarSubscriptionInfo,
} from "@/features/calendar/types";

const GONE_STATUSES = new Set([401, 403, 404, 410]);

/** One line naming why a feed stopped updating, in the member's terms. */
export function subscriptionErrorCopy(subscription: CalendarSubscriptionInfo): string {
  return feedErrorCopy(subscription.lastError, subscription.lastErrorStatus);
}

/** One line naming why an address could not be read, for the row and for the subscribe form. */
export function feedErrorCopy(
  error: CalendarSubscriptionError | undefined,
  status: number,
): string {
  switch (error) {
    case "http_status":
      return GONE_STATUSES.has(status)
        ? "The address no longer works. If it was reset at the source, paste the new one."
        : "The calendar's server returned an error.";
    case "blocked_address":
      return "This address points to a private network, which this deployment does not allow.";
    case "not_a_calendar":
      return "The address did not return a calendar.";
    case "unprocessable":
      return "The calendar has entries Uniffy could not store.";
    case "too_large":
    case "too_many_events":
      return "The calendar is larger than Uniffy can follow.";
    case "redirect_refused":
    case "too_many_redirects":
      return "The address redirects somewhere Uniffy will not follow.";
    case "invalid_url":
      return "The address is not a calendar link.";
    case "timeout":
    case "unreachable":
    case "unresolvable":
      return "Could not reach the address.";
    default:
      return "The calendar could not be refreshed.";
  }
}
