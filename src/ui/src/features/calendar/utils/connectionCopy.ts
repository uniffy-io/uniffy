import type {
  CalendarConnectionStatus,
  CalendarProviderId,
  CalendarSyncError,
  ConnectedCalendarState,
  ProviderCredentialSource,
} from "@/features/calendar/types/connections";

const PROVIDER_NAMES: Record<CalendarProviderId, string> = {
  google: "Google",
  microsoft: "Microsoft",
};

const PROVIDER_CALENDAR_NAMES: Record<CalendarProviderId, string> = {
  google: "Google Calendar",
  microsoft: "Outlook",
};

/** The company, for account labels and the connect menu. */
export function providerName(provider: CalendarProviderId | null): string {
  return provider ? PROVIDER_NAMES[provider] : "Calendar";
}

/** The calendar product people know, for "edit it in ..." copy. */
export function providerCalendarName(provider: CalendarProviderId | null): string {
  return provider ? PROVIDER_CALENDAR_NAMES[provider] : "its own calendar";
}

/** Why a connected calendar stopped syncing, in the member's terms. */
export function syncErrorCopy(
  error: CalendarSyncError | undefined,
  provider: CalendarProviderId | null,
): string {
  const name = providerCalendarName(provider);
  switch (error) {
    case "unreachable":
      return `Could not reach ${name}.`;
    case "rate_limited":
      return `${name} asked Uniffy to slow down. Syncing resumes shortly.`;
    case "permission_denied":
      return "The account may no longer change this calendar.";
    case "not_found":
      return `The calendar no longer exists in ${name}.`;
    case "reauth_required":
      return `${name} no longer accepts the sign-in. Connect the account again.`;
    case "unprocessable":
      return "The calendar has entries Uniffy could not store.";
    case "provider_error":
      return `${name} returned an error.`;
    default:
      return "The calendar could not be synced.";
  }
}

/**
 * The status line under a connected calendar, or null while it is healthy. Failing and
 * broken states name the error; the rest describe what is holding sync back.
 */
export function connectedStateCopy(
  state: ConnectedCalendarState,
  error: CalendarSyncError | undefined,
  provider: CalendarProviderId | null,
): string | null {
  switch (state) {
    case "healthy":
      return null;
    case "pending":
      return "Syncing for the first time...";
    case "paused":
      return "Paused";
    case "reauth_required":
      return `${providerName(provider)} sign-in expired. Reconnect to resume.`;
    case "detached":
      return "Disconnected. Events stay, but no longer sync.";
    case "failing":
    case "broken":
      return syncErrorCopy(error, provider);
  }
}

/** A connected calendar in a state the member should act on. */
export function needsAttention(state: ConnectedCalendarState): boolean {
  return state === "broken" || state === "reauth_required";
}

export function connectionStatusCopy(status: CalendarConnectionStatus): string {
  switch (status) {
    case "active":
      return "Syncing";
    case "paused":
      return "Paused";
    case "reauth_required":
      return "Reconnect needed";
    case "disconnected":
      return "Disconnected";
  }
}

export function credentialSourceCopy(source: ProviderCredentialSource): string {
  switch (source) {
    case "deployment":
      return "Using the deployment's app";
    case "organization":
      return "Using this organization's app";
    case "none":
      return "Not configured";
  }
}

/** The read-only note on an event that can only change at its provider. */
export function providerEditHintCopy(provider: CalendarProviderId, series: boolean): string {
  return `Edit this ${series ? "series" : "event"} in ${providerCalendarName(provider)}`;
}
